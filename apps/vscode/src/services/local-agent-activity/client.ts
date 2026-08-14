import type { ClientRequest, IncomingHttpHeaders, IncomingMessage, RequestOptions } from "node:http"
import { request as nodeRequest } from "node:http"
import { isAbsolute } from "node:path"
import { StringDecoder } from "node:string_decoder"
import {
	type LocalAgentActivityEvent,
	type LocalAgentActivitySnapshot,
	parseLocalAgentActivityEvent,
	parseLocalAgentActivitySnapshot,
} from "./contract"

const MAX_SNAPSHOT_BYTES = 1_048_576
const MAX_SSE_BUFFER_BYTES = 262_144
const MAX_SSE_EVENT_BYTES = 16_384

export interface LocalActivityHttpResponse {
	statusCode: number
	headers: IncomingHttpHeaders
	body: AsyncIterable<Uint8Array | string>
}

export type LocalActivityHttpGet = (path: string, signal?: AbortSignal) => Promise<LocalActivityHttpResponse>

export class LocalAgentActivityClientError extends Error {
	public constructor(message: string) {
		super(message)
		this.name = "LocalAgentActivityClientError"
	}
}

export function createUnixSocketActivityTransport(
	socketPath: string,
	requestImplementation: typeof nodeRequest = nodeRequest,
): LocalActivityHttpGet {
	if (!isAbsolute(socketPath)) {
		throw new LocalAgentActivityClientError("local activity socket path must be absolute")
	}

	return (path, signal) =>
		new Promise<LocalActivityHttpResponse>((resolve, reject) => {
			if (signal?.aborted) {
				reject(new LocalAgentActivityClientError("local activity request was aborted"))
				return
			}

			const options: RequestOptions = {
				method: "GET",
				socketPath,
				path,
				headers: {
					Accept: path.endsWith("/snapshot") ? "application/json" : "text/event-stream",
					Host: "localhost",
				},
			}
			let request: ClientRequest
			const abortBeforeResponse = () => {
				request.destroy(new LocalAgentActivityClientError("local activity request was aborted"))
			}
			request = requestImplementation(options, (response: IncomingMessage) => {
				signal?.removeEventListener("abort", abortBeforeResponse)
				const abortResponse = () => {
					response.destroy(new LocalAgentActivityClientError("local activity request was aborted"))
				}
				signal?.addEventListener("abort", abortResponse, { once: true })
				response.once("close", () => signal?.removeEventListener("abort", abortResponse))
				resolve({
					statusCode: response.statusCode ?? 0,
					headers: response.headers,
					body: response,
				})
			})
			request.once("error", (error) => {
				signal?.removeEventListener("abort", abortBeforeResponse)
				reject(new LocalAgentActivityClientError(`local activity request failed: ${safeErrorName(error)}`))
			})
			signal?.addEventListener("abort", abortBeforeResponse, { once: true })
			request.end()
		})
}

export async function fetchLocalAgentActivitySnapshot(
	get: LocalActivityHttpGet,
	signal?: AbortSignal,
): Promise<LocalAgentActivitySnapshot> {
	const response = await get("/v1/activity/snapshot", signal)
	assertResponse(response, "application/json")
	const body = await readBoundedBody(response.body, MAX_SNAPSHOT_BYTES)
	let payload: unknown
	try {
		payload = JSON.parse(body)
	} catch {
		throw new LocalAgentActivityClientError("local activity snapshot is not valid JSON")
	}
	try {
		return parseLocalAgentActivitySnapshot(payload)
	} catch {
		throw new LocalAgentActivityClientError("local activity snapshot violates the contract")
	}
}

export async function streamLocalAgentActivity(
	get: LocalActivityHttpGet,
	options: {
		after: number
		onEvent: (event: LocalAgentActivityEvent) => void
		signal?: AbortSignal
	},
): Promise<number> {
	if (!Number.isSafeInteger(options.after) || options.after < 0) {
		throw new LocalAgentActivityClientError("local activity cursor is invalid")
	}
	const response = await get(`/v1/activity/events?after=${options.after}`, options.signal)
	assertResponse(response, "text/event-stream")
	let cursor = options.after
	for await (const event of parseLocalAgentActivitySse(response.body, cursor)) {
		if (options.signal?.aborted) {
			break
		}
		cursor = event.sequence
		options.onEvent(event)
	}
	return cursor
}

export async function* parseLocalAgentActivitySse(
	chunks: AsyncIterable<Uint8Array | string>,
	after: number,
): AsyncGenerator<LocalAgentActivityEvent> {
	const decoder = new StringDecoder("utf8")
	let buffer = ""
	let cursor = after

	for await (const chunk of chunks) {
		buffer += typeof chunk === "string" ? chunk : decoder.write(chunk)
		if (Buffer.byteLength(buffer, "utf8") > MAX_SSE_BUFFER_BYTES) {
			throw new LocalAgentActivityClientError("local activity stream buffer exceeded its limit")
		}
		while (true) {
			const boundary = findEventBoundary(buffer)
			if (!boundary) {
				break
			}
			const block = buffer.slice(0, boundary.index)
			buffer = buffer.slice(boundary.index + boundary.length)
			const event = parseSseBlock(block)
			if (!event || event.sequence <= cursor) {
				continue
			}
			cursor = event.sequence
			yield event
		}
	}

	buffer += decoder.end()
	if (buffer.trim()) {
		throw new LocalAgentActivityClientError("local activity stream ended with an incomplete event")
	}
}

function parseSseBlock(block: string): LocalAgentActivityEvent | null {
	if (Buffer.byteLength(block, "utf8") > MAX_SSE_EVENT_BYTES) {
		throw new LocalAgentActivityClientError("local activity event exceeded its limit")
	}
	const normalized = block.replaceAll("\r\n", "\n")
	if (!normalized || normalized.startsWith(":")) {
		return null
	}
	let id: string | undefined
	let eventName: string | undefined
	const data: string[] = []
	for (const line of normalized.split("\n")) {
		if (!line || line.startsWith(":")) {
			continue
		}
		const separator = line.indexOf(":")
		const field = separator >= 0 ? line.slice(0, separator) : line
		const rawValue = separator >= 0 ? line.slice(separator + 1) : ""
		const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue
		if (field === "id" && id === undefined) {
			id = value
		} else if (field === "event" && eventName === undefined) {
			eventName = value
		} else if (field === "data") {
			data.push(value)
		} else {
			throw new LocalAgentActivityClientError("local activity stream contains an unsupported SSE field")
		}
	}
	if (eventName === "observer_error") {
		throw new LocalAgentActivityClientError("local activity observer reported an error")
	}
	if (eventName !== "activity" || id === undefined || data.length === 0) {
		throw new LocalAgentActivityClientError("local activity SSE envelope is incomplete")
	}
	if (!/^\d+$/.test(id)) {
		throw new LocalAgentActivityClientError("local activity SSE id is invalid")
	}
	const sequence = Number(id)
	if (!Number.isSafeInteger(sequence)) {
		throw new LocalAgentActivityClientError("local activity SSE id exceeds the safe range")
	}
	let payload: unknown
	try {
		payload = JSON.parse(data.join("\n"))
	} catch {
		throw new LocalAgentActivityClientError("local activity SSE data is not valid JSON")
	}
	let event: LocalAgentActivityEvent
	try {
		event = parseLocalAgentActivityEvent(payload)
	} catch {
		throw new LocalAgentActivityClientError("local activity SSE data violates the contract")
	}
	if (event.sequence !== sequence) {
		throw new LocalAgentActivityClientError("local activity SSE id does not match its event")
	}
	return event
}

function assertResponse(response: LocalActivityHttpResponse, mediaType: string): void {
	if (response.statusCode !== 200) {
		throw new LocalAgentActivityClientError(`local activity observer returned HTTP ${response.statusCode}`)
	}
	const contentType = response.headers["content-type"]
	const value = Array.isArray(contentType) ? contentType[0] : contentType
	if (!value?.toLowerCase().startsWith(mediaType)) {
		throw new LocalAgentActivityClientError("local activity observer returned an invalid content type")
	}
}

async function readBoundedBody(body: AsyncIterable<Uint8Array | string>, maximumBytes: number): Promise<string> {
	const decoder = new StringDecoder("utf8")
	let result = ""
	let bytes = 0
	for await (const chunk of body) {
		bytes += typeof chunk === "string" ? Buffer.byteLength(chunk, "utf8") : chunk.byteLength
		if (bytes > maximumBytes) {
			throw new LocalAgentActivityClientError("local activity response exceeded its limit")
		}
		result += typeof chunk === "string" ? chunk : decoder.write(chunk)
	}
	return result + decoder.end()
}

function findEventBoundary(value: string): { index: number; length: number } | null {
	const unixIndex = value.indexOf("\n\n")
	const windowsIndex = value.indexOf("\r\n\r\n")
	if (unixIndex < 0 && windowsIndex < 0) {
		return null
	}
	if (windowsIndex >= 0 && (unixIndex < 0 || windowsIndex < unixIndex)) {
		return { index: windowsIndex, length: 4 }
	}
	return { index: unixIndex, length: 2 }
}

function safeErrorName(error: Error): string {
	return error.name || "Error"
}

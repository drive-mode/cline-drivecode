import { useEffect } from "react";
import { useAudioDevices } from "@/components/ai-elements/mic-selector";

/**
 * Native select over audiooutput devices for Drive Settings.
 * Labels improve after a one-time mic permission prompt (browser limitation).
 */
export function SpeakerDeviceSelect({
	value,
	onChange,
}: {
	value: string | undefined;
	onChange: (speakerDeviceId: string | undefined) => void;
}) {
	const { devices, loadDevices, hasPermission, loading, micDenied } =
		useAudioDevices("audiooutput");

	useEffect(() => {
		// Nothing gates this on a popover being open, so a blocked mic would ask
		// on every loading flip for as long as the panel is mounted.
		if (!hasPermission && !loading && !micDenied) {
			void loadDevices();
		}
	}, [hasPermission, loading, loadDevices, micDenied]);

	return (
		<select
			aria-label="Speaker output"
			className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
			onChange={(event) => {
				const next = event.target.value;
				onChange(next === "__default__" ? undefined : next);
			}}
			value={value ?? "__default__"}
		>
			<option value="__default__">System default</option>
			{devices.map((device) => (
				<option key={device.deviceId} value={device.deviceId}>
					{device.label || `Speaker ${device.deviceId.slice(0, 8)}`}
				</option>
			))}
		</select>
	);
}

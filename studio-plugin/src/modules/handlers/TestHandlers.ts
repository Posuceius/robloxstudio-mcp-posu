import { LogService } from "@rbxts/services";

const StudioTestService = game.GetService("StudioTestService");
const ServerScriptService = game.GetService("ServerScriptService");
const ScriptEditorService = game.GetService("ScriptEditorService");

const STOP_SIGNAL = "__MCP_STOP__";

interface OutputEntry {
	message: string;
	messageType: string;
	timestamp: number;
}

let testRunning = false;
let outputBuffer: OutputEntry[] = [];
let logConnection: RBXScriptConnection | undefined;
let testResult: unknown;
let testError: string | undefined;
let stopListenerScript: Script | undefined;

function buildStopListenerSource(): string {
	return `local LogService = game:GetService("LogService")
local StudioTestService = game:GetService("StudioTestService")
LogService.MessageOut:Connect(function(message)
	if message == "${STOP_SIGNAL}" then
		pcall(function() StudioTestService:EndTest("stopped_by_mcp") end)
	end
end)`;
}

function injectStopListener() {
	const listener = new Instance("Script");
	listener.Name = "__MCP_StopListener";
	listener.Parent = ServerScriptService;

	const source = buildStopListenerSource();
	const [seOk] = pcall(() => {
		ScriptEditorService.UpdateSourceAsync(listener, () => source);
	});
	if (!seOk) {
		(listener as unknown as { Source: string }).Source = source;
	}

	stopListenerScript = listener;
}

function cleanupStopListener() {
	if (stopListenerScript) {
		pcall(() => stopListenerScript!.Destroy());
		stopListenerScript = undefined;
	}
}

function startPlaytest(requestData: Record<string, unknown>) {
	const mode = requestData.mode as string | undefined;
	const numPlayers = (requestData.numPlayers as number) ?? 1;

	if (mode !== "play" && mode !== "run") {
		return { error: 'mode must be "play" or "run"' };
	}

	if (testRunning) {
		return { error: "A test is already running" };
	}

	testRunning = true;
	outputBuffer = [];
	testResult = undefined;
	testError = undefined;

	cleanupStopListener();

	logConnection = LogService.MessageOut.Connect((message, messageType) => {
		if (message === STOP_SIGNAL) return;
		outputBuffer.push({
			message,
			messageType: messageType.Name,
			timestamp: tick(),
		});
	});

	const [injected, injErr] = pcall(() => injectStopListener());
	if (!injected) {
		warn(`[MCP] Failed to inject stop listener: ${injErr}`);
	}

	task.spawn(() => {
		const [ok, result] = pcall(() => {
			if (mode === "play") {
				return StudioTestService.ExecutePlayModeAsync({ NumPlayers: numPlayers });
			}
			return StudioTestService.ExecuteRunModeAsync({});
		});

		if (ok) {
			testResult = result;
		} else {
			testError = tostring(result);
		}

		if (logConnection) {
			logConnection.Disconnect();
			logConnection = undefined;
		}
		testRunning = false;

		cleanupStopListener();
	});

	return { success: true, message: `Playtest started in ${mode} mode` };
}

function stopPlaytest(_requestData: Record<string, unknown>) {
	if (!testRunning) {
		return { error: "No test is currently running" };
	}

	warn(STOP_SIGNAL);

	return {
		success: true,
		output: [...outputBuffer],
		outputCount: outputBuffer.size(),
		message: "Playtest stop signal sent.",
	};
}

function getPlaytestOutput(_requestData: Record<string, unknown>) {
	return {
		isRunning: testRunning,
		output: [...outputBuffer],
		outputCount: outputBuffer.size(),
		testResult: testResult !== undefined ? tostring(testResult) : undefined,
		testError,
	};
}

function characterNavigation(requestData: Record<string, unknown>) {
	const action = requestData.action as string;
	const target = requestData.target as string | undefined;

	if (!action) return { error: "action is required" };

	const Players = game.GetService("Players");
	const localPlayer = Players.LocalPlayer;
	if (!localPlayer) return { error: "No local player found - must be in Play mode" };

	const character = localPlayer.Character;
	if (!character) return { error: "Player has no character" };

	const humanoid = character.FindFirstChildOfClass("Humanoid");
	if (!humanoid) return { error: "Character has no Humanoid" };

	const [success, result] = pcall(() => {
		if (action === "moveTo") {
			if (!target) error("target path is required for moveTo");
			const targetInstance = (game as unknown as { GetService(name: string): Instance }).GetService
				? game.FindFirstChild(target, true)
				: undefined;

			const rootPart = character.FindFirstChild("HumanoidRootPart") as BasePart | undefined;
			if (!rootPart) error("Character has no HumanoidRootPart");

			if (targetInstance && targetInstance.IsA("BasePart")) {
				humanoid.MoveTo(targetInstance.Position, targetInstance);
			} else {
				error(`Target not found or not a BasePart: ${target}`);
			}
			return { success: true, action, message: `Moving character to ${target}` };
		} else if (action === "jump") {
			humanoid.Jump = true;
			return { success: true, action, message: "Character jump triggered" };
		} else if (action === "stop") {
			humanoid.MoveTo(rootPart(character) ?? humanoid.RootPart?.Position ?? new Vector3(0, 0, 0));
			return { success: true, action, message: "Character movement stopped" };
		} else {
			error(`Unknown action: ${action}`);
		}
	});

	if (success) return result;
	return { error: `characterNavigation failed: ${tostring(result)}` };
}

function rootPart(character: Model): Vector3 {
	const root = character.FindFirstChild("HumanoidRootPart") as BasePart | undefined;
	return root?.Position ?? new Vector3(0, 0, 0);
}

export = {
	startPlaytest,
	stopPlaytest,
	getPlaytestOutput,
	characterNavigation,
};

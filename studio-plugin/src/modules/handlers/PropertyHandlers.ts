import Utils from "../Utils";
import Recording from "../Recording";

const { getInstanceByPath, convertPropertyValue } = Utils;
const { beginRecording, finishRecording } = Recording;

function setProperty(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const propertyName = requestData.propertyName as string;
	const propertyValue = requestData.propertyValue;

	if (!instancePath || !propertyName) {
		return { error: "Instance path and property name are required" };
	}

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };
	const recordingId = beginRecording(`Set ${propertyName} property`);

	const inst = instance as unknown as Record<string, unknown>;

	const [success, result] = pcall(() => {
		if (propertyName === "Parent" || propertyName === "PrimaryPart") {
			if (typeIs(propertyValue, "string")) {
				const refInstance = getInstanceByPath(propertyValue);
				if (refInstance) {
					inst[propertyName] = refInstance;
				} else {
					return { error: `${propertyName} instance not found: ${propertyValue}` };
				}
			}
		} else if (propertyName === "Name") {
			instance.Name = tostring(propertyValue);
		} else if (propertyName === "Source" && instance.IsA("LuaSourceContainer")) {
			(instance as unknown as { Source: string }).Source = tostring(propertyValue);
		} else {
			const convertedValue = convertPropertyValue(instance, propertyName, propertyValue);
			if (convertedValue !== undefined) {
				inst[propertyName] = convertedValue;
			} else {
				inst[propertyName] = propertyValue;
			}
		}

		return true;
	});

	if (success) {
		finishRecording(recordingId, true);
		return {
			success: true,
			instancePath,
			propertyName,
			propertyValue,
			message: "Property set successfully",
		};
	} else {
		finishRecording(recordingId, false);
		return { error: `Failed to set property: ${result}`, instancePath, propertyName };
	}
}

function setProperties(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const properties = requestData.properties as Record<string, unknown>;

	if (!instancePath || !properties || !typeIs(properties, "table")) {
		return { error: "Instance path and properties object are required" };
	}

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };

	const inst = instance as unknown as Record<string, unknown>;
	const results: Record<string, unknown>[] = [];
	let successCount = 0;
	let failureCount = 0;
	const recordingId = beginRecording("Set multiple properties");

	for (const [propertyName, propertyValue] of pairs(properties)) {
		const propName = tostring(propertyName);

		const [success, err] = pcall(() => {
			if (propName === "Parent" || propName === "PrimaryPart") {
				if (typeIs(propertyValue, "string")) {
					const refInstance = getInstanceByPath(propertyValue);
					if (refInstance) {
						inst[propName] = refInstance;
					} else {
						error(`${propName} instance not found: ${propertyValue}`);
					}
				}
			} else if (propName === "Name") {
				instance.Name = tostring(propertyValue);
			} else if (propName === "Source" && instance.IsA("LuaSourceContainer")) {
				(instance as unknown as { Source: string }).Source = tostring(propertyValue);
			} else {
				const convertedValue = convertPropertyValue(instance, propName, propertyValue);
				if (convertedValue !== undefined) {
					inst[propName] = convertedValue;
				} else {
					inst[propName] = propertyValue;
				}
			}
		});

		if (success) {
			successCount++;
			results.push({ propertyName: propName, success: true, propertyValue });
		} else {
			failureCount++;
			results.push({ propertyName: propName, success: false, error: tostring(err) });
		}
	}

	finishRecording(recordingId, successCount > 0);

	return {
		success: successCount > 0,
		instancePath,
		results,
		summary: { total: results.size(), succeeded: successCount, failed: failureCount },
	};
}

function massSetProperty(requestData: Record<string, unknown>) {
	const paths = requestData.paths as string[];
	const propertyName = requestData.propertyName as string;
	const propertyValue = requestData.propertyValue;

	if (!paths || !typeIs(paths, "table") || (paths as defined[]).size() === 0 || !propertyName) {
		return { error: "Paths array and property name are required" };
	}

	const results: Record<string, unknown>[] = [];
	let successCount = 0;
	let failureCount = 0;
	const recordingId = beginRecording(`Mass set ${propertyName} property`);

	for (const path of paths) {
		const instance = getInstanceByPath(path);
		if (instance) {
			const [success, err] = pcall(() => {
				(instance as unknown as Record<string, unknown>)[propertyName] = propertyValue;
			});
			if (success) {
				successCount++;
				results.push({ path, success: true, propertyName, propertyValue });
			} else {
				failureCount++;
				results.push({ path, success: false, error: tostring(err) });
			}
		} else {
			failureCount++;
			results.push({ path, success: false, error: "Instance not found" });
		}
	}

	finishRecording(recordingId, successCount > 0);

	return {
		results,
		summary: { total: paths.size(), succeeded: successCount, failed: failureCount },
	};
}

function massGetProperty(requestData: Record<string, unknown>) {
	const paths = requestData.paths as string[];
	const propertyName = requestData.propertyName as string;

	if (!paths || !typeIs(paths, "table") || (paths as defined[]).size() === 0 || !propertyName) {
		return { error: "Paths array and property name are required" };
	}

	const results: Record<string, unknown>[] = [];

	for (const path of paths) {
		const instance = getInstanceByPath(path);
		if (instance) {
			const [success, value] = pcall(() => (instance as unknown as Record<string, unknown>)[propertyName]);
			if (success) {
				results.push({ path, success: true, propertyName, propertyValue: value });
			} else {
				results.push({ path, success: false, error: tostring(value) });
			}
		} else {
			results.push({ path, success: false, error: "Instance not found" });
		}
	}

	return { results, propertyName };
}

export = {
	setProperty,
	setProperties,
	massSetProperty,
	massGetProperty,
};

import Utils from "../Utils";
import Recording from "../Recording";

const ScriptEditorService = game.GetService("ScriptEditorService");

const { getInstancePath, getInstanceByPath, readScriptSource, splitLines, joinLines } = Utils;
const { beginRecording, finishRecording } = Recording;

function normalizeEscapes(s: string): string {
	let result = s;
	result = result.gsub("\\n", "\n")[0];
	result = result.gsub("\\t", "\t")[0];
	result = result.gsub("\\r", "\r")[0];
	result = result.gsub('\\"', '"')[0];
	result = result.gsub("\\\\", "\\")[0];
	return result;
}

function getScriptSource(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const startLine = requestData.startLine as number | undefined;
	const endLine = requestData.endLine as number | undefined;

	if (!instancePath) return { error: "Instance path is required" };

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };
	if (!instance.IsA("LuaSourceContainer")) {
		return { error: `Instance is not a script-like object: ${instance.ClassName}` };
	}

	const [success, result] = pcall(() => {
		const fullSource = readScriptSource(instance);
		const [lines, hasTrailingNewline] = splitLines(fullSource);
		const totalLineCount = lines.size();

		let sourceToReturn = fullSource;
		let returnedStartLine = 1;
		let returnedEndLine = totalLineCount;

		if (startLine !== undefined || endLine !== undefined) {
			const actualStartLine = math.max(1, startLine ?? 1);
			const actualEndLine = math.min(lines.size(), endLine ?? lines.size());

			const selectedLines: string[] = [];
			for (let i = actualStartLine; i <= actualEndLine; i++) {
				selectedLines.push(lines[i - 1] ?? "");
			}

			sourceToReturn = selectedLines.join("\n");
			if (hasTrailingNewline && actualEndLine === lines.size() && sourceToReturn.sub(-1) !== "\n") {
				sourceToReturn += "\n";
			}
			returnedStartLine = actualStartLine;
			returnedEndLine = actualEndLine;
		}

		const numberedLines: string[] = [];
		const linesToNumber = startLine !== undefined ? splitLines(sourceToReturn)[0] : lines;
		const lineOffset = returnedStartLine - 1;
		for (let i = 0; i < linesToNumber.size(); i++) {
			numberedLines.push(`${i + 1 + lineOffset}: ${linesToNumber[i]}`);
		}
		const numberedSource = numberedLines.join("\n");

		const resp: Record<string, unknown> = {
			instancePath,
			className: instance.ClassName,
			name: instance.Name,
			source: sourceToReturn,
			numberedSource,
			sourceLength: fullSource.size(),
			lineCount: totalLineCount,
			startLine: returnedStartLine,
			endLine: returnedEndLine,
			isPartial: startLine !== undefined || endLine !== undefined,
			truncated: false,
		};

		if (startLine === undefined && endLine === undefined && fullSource.size() > 50000) {
			const truncatedLines: string[] = [];
			const truncatedNumberedLines: string[] = [];
			const maxLines = math.min(1000, lines.size());
			for (let i = 0; i < maxLines; i++) {
				truncatedLines.push(lines[i]);
				truncatedNumberedLines.push(`${i + 1}: ${lines[i]}`);
			}
			resp.source = truncatedLines.join("\n");
			resp.numberedSource = truncatedNumberedLines.join("\n");
			resp.truncated = true;
			resp.endLine = maxLines;
			resp.note = "Script truncated to first 1000 lines. Use startLine/endLine parameters to read specific sections.";
		}

		if (instance.IsA("BaseScript")) {
			resp.enabled = instance.Enabled;
		}

		let topServiceInstance: Instance = instance;
		while (topServiceInstance.Parent && topServiceInstance.Parent !== game) {
			topServiceInstance = topServiceInstance.Parent;
		}
		resp.topService = topServiceInstance.Name;

		return resp;
	});

	if (success) {
		return result;
	} else {
		return { error: `Failed to get script source: ${result}` };
	}
}

function setScriptSource(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const newSource = requestData.source as string;

	if (!instancePath || !newSource) return { error: "Instance path and source are required" };

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };
	if (!instance.IsA("LuaSourceContainer")) {
		return { error: `Instance is not a script-like object: ${instance.ClassName}` };
	}

	const sourceToSet = normalizeEscapes(newSource);
	const recordingId = beginRecording(`Set script source: ${instance.Name}`);

	const [updateSuccess, updateResult] = pcall(() => {
		const oldSourceLength = readScriptSource(instance).size();

		ScriptEditorService.UpdateSourceAsync(instance, () => sourceToSet);

		return {
			success: true, instancePath,
			oldSourceLength, newSourceLength: sourceToSet.size(),
			method: "UpdateSourceAsync",
			message: "Script source updated successfully (editor-safe)",
		};
	});

	if (updateSuccess) {
		finishRecording(recordingId, true);
		return updateResult;
	}

	const [directSuccess, directResult] = pcall(() => {
		const oldSource = (instance as unknown as { Source: string }).Source;
		(instance as unknown as { Source: string }).Source = sourceToSet;

		return {
			success: true, instancePath,
			oldSourceLength: oldSource.size(), newSourceLength: sourceToSet.size(),
			method: "direct",
			message: "Script source updated successfully (direct assignment)",
		};
	});

	if (directSuccess) {
		finishRecording(recordingId, true);
		return directResult;
	}

	const [replaceSuccess, replaceResult] = pcall(() => {
		const parent = instance.Parent;
		const name = instance.Name;
		const className = instance.ClassName;
		const wasBaseScript = instance.IsA("BaseScript");
		const enabled = wasBaseScript ? instance.Enabled : undefined;

		const newScript = new Instance(className as keyof CreatableInstances) as LuaSourceContainer;
		newScript.Name = name;
		(newScript as unknown as { Source: string }).Source = sourceToSet;
		if (wasBaseScript && enabled !== undefined) {
			(newScript as BaseScript).Enabled = enabled;
		}

		newScript.Parent = parent;
		instance.Destroy();

		return {
			success: true,
			instancePath: getInstancePath(newScript),
			method: "replace",
			message: "Script replaced successfully with new source",
		};
	});

	if (replaceSuccess) {
		finishRecording(recordingId, true);
		return replaceResult;
	}

	finishRecording(recordingId, false);
	return {
		error: `Failed to set script source. UpdateSourceAsync failed: ${updateResult}. Direct assignment failed: ${directResult}. Replace method failed: ${replaceResult}`,
	};
}

function editScriptLines(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const startLine = requestData.startLine as number;
	const endLine = requestData.endLine as number;
	let newContent = requestData.newContent as string;

	if (!instancePath || !startLine || !endLine || !newContent) {
		return { error: "Instance path, startLine, endLine, and newContent are required" };
	}

	newContent = normalizeEscapes(newContent);

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };
	if (!instance.IsA("LuaSourceContainer")) {
		return { error: `Instance is not a script-like object: ${instance.ClassName}` };
	}

	const recordingId = beginRecording(`Edit script lines ${startLine}-${endLine}: ${instance.Name}`);

	const [success, result] = pcall(() => {
		const [lines, hadTrailingNewline] = splitLines(readScriptSource(instance));
		const totalLines = lines.size();

		if (startLine < 1 || startLine > totalLines) error(`startLine out of range (1-${totalLines})`);
		if (endLine < startLine || endLine > totalLines) error(`endLine out of range (${startLine}-${totalLines})`);

		const [newLines] = splitLines(newContent);
		const resultLines: string[] = [];

		for (let i = 0; i < startLine - 1; i++) resultLines.push(lines[i]);
		for (const line of newLines) resultLines.push(line);
		for (let i = endLine; i < totalLines; i++) resultLines.push(lines[i]);

		const newSource = joinLines(resultLines, hadTrailingNewline);
		ScriptEditorService.UpdateSourceAsync(instance, () => newSource);

		return {
			success: true, instancePath,
			editedLines: { startLine, endLine },
			linesRemoved: endLine - startLine + 1,
			linesAdded: newLines.size(),
			newLineCount: resultLines.size(),
			message: "Script lines edited successfully",
		};
	});

	if (success) {
		finishRecording(recordingId, true);
		return result;
	}
	finishRecording(recordingId, false);
	return { error: `Failed to edit script lines: ${result}` };
}

function insertScriptLines(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const afterLine = (requestData.afterLine as number) ?? 0;
	let newContent = requestData.newContent as string;

	if (!instancePath || !newContent) return { error: "Instance path and newContent are required" };

	newContent = normalizeEscapes(newContent);

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };
	if (!instance.IsA("LuaSourceContainer")) {
		return { error: `Instance is not a script-like object: ${instance.ClassName}` };
	}

	const recordingId = beginRecording(`Insert script lines after line ${afterLine}: ${instance.Name}`);

	const [success, result] = pcall(() => {
		const [lines, hadTrailingNewline] = splitLines(readScriptSource(instance));
		const totalLines = lines.size();

		if (afterLine < 0 || afterLine > totalLines) error(`afterLine out of range (0-${totalLines})`);

		const [newLines] = splitLines(newContent);
		const resultLines: string[] = [];

		for (let i = 0; i < afterLine; i++) resultLines.push(lines[i]);
		for (const line of newLines) resultLines.push(line);
		for (let i = afterLine; i < totalLines; i++) resultLines.push(lines[i]);

		const newSource = joinLines(resultLines, hadTrailingNewline);
		ScriptEditorService.UpdateSourceAsync(instance, () => newSource);

		return {
			success: true, instancePath,
			insertedAfterLine: afterLine,
			linesInserted: newLines.size(),
			newLineCount: resultLines.size(),
			message: "Script lines inserted successfully",
		};
	});

	if (success) {
		finishRecording(recordingId, true);
		return result;
	}
	finishRecording(recordingId, false);
	return { error: `Failed to insert script lines: ${result}` };
}

function deleteScriptLines(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const startLine = requestData.startLine as number;
	const endLine = requestData.endLine as number;

	if (!instancePath || !startLine || !endLine) {
		return { error: "Instance path, startLine, and endLine are required" };
	}

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };
	if (!instance.IsA("LuaSourceContainer")) {
		return { error: `Instance is not a script-like object: ${instance.ClassName}` };
	}

	const recordingId = beginRecording(`Delete script lines ${startLine}-${endLine}: ${instance.Name}`);

	const [success, result] = pcall(() => {
		const [lines, hadTrailingNewline] = splitLines(readScriptSource(instance));
		const totalLines = lines.size();

		if (startLine < 1 || startLine > totalLines) error(`startLine out of range (1-${totalLines})`);
		if (endLine < startLine || endLine > totalLines) error(`endLine out of range (${startLine}-${totalLines})`);

		const resultLines: string[] = [];
		for (let i = 0; i < startLine - 1; i++) resultLines.push(lines[i]);
		for (let i = endLine; i < totalLines; i++) resultLines.push(lines[i]);

		const newSource = joinLines(resultLines, hadTrailingNewline);
		ScriptEditorService.UpdateSourceAsync(instance, () => newSource);

		return {
			success: true, instancePath,
			deletedLines: { startLine, endLine },
			linesDeleted: endLine - startLine + 1,
			newLineCount: resultLines.size(),
			message: "Script lines deleted successfully",
		};
	});

	if (success) {
		finishRecording(recordingId, true);
		return result;
	}
	finishRecording(recordingId, false);
	return { error: `Failed to delete script lines: ${result}` };
}

function findAndReplaceInScripts(requestData: Record<string, unknown>) {
	const pattern = requestData.pattern as string;
	const replacement = requestData.replacement as string;
	const path = (requestData.path as string) ?? "game";
	const caseSensitive = (requestData.caseSensitive as boolean) ?? false;
	const usePattern = (requestData.usePattern as boolean) ?? false;
	const classFilter = requestData.classFilter as string | undefined;
	const dryRun = (requestData.dryRun as boolean) ?? false;
	const maxReplacements = requestData.maxReplacements as number | undefined;

	if (!pattern || replacement === undefined) {
		return { error: "Search pattern and replacement string are required" };
	}

	const root = getInstanceByPath(path);
	if (!root) return { error: `Path not found: ${path}` };

	const recordingId = dryRun ? undefined : beginRecording("Find and replace in scripts");
	const results: Record<string, unknown>[] = [];
	let totalReplacements = 0;
	let scriptsModified = 0;
	let hitLimit = false;

	function walkScripts(instance: Instance) {
		if (hitLimit) return;

		if (instance.IsA("LuaSourceContainer")) {
			if (classFilter && !instance.ClassName.lower().find(classFilter.lower())[0]) {
				for (const child of instance.GetChildren()) walkScripts(child);
				return;
			}

			const [readSuccess, source] = pcall(() => readScriptSource(instance));
			if (!readSuccess || !typeIs(source, "string")) {
				for (const child of instance.GetChildren()) walkScripts(child);
				return;
			}

			const originalSource = source as string;
			const searchKey = caseSensitive ? pattern : pattern.lower();
			const sourceToSearch = caseSensitive ? originalSource : originalSource.lower();

			let matchCount = 0;
			let searchIndex = 0;

			while (true) {
				if (maxReplacements !== undefined && totalReplacements + matchCount >= maxReplacements) {
					hitLimit = true;
					break;
				}

				let foundStart: number | undefined;
				if (usePattern) {
					[foundStart] = string.find(sourceToSearch, searchKey, searchIndex);
				} else {
					[foundStart] = string.find(sourceToSearch, searchKey, searchIndex, true);
				}

				if (!foundStart) break;
				matchCount++;
				searchIndex = foundStart + searchKey.size();
			}

			if (matchCount > 0) {
				const scriptPath = getInstancePath(instance);

				if (!dryRun) {
					const newParts: string[] = [];
					let lastEnd = 0;
					let searchPos = 0;
					let replacementsDone = 0;

					while (true) {
						if (maxReplacements !== undefined && replacementsDone >= maxReplacements) break;

						let foundStart: number | undefined;
						let foundEnd: number | undefined;
						if (usePattern) {
							[foundStart, foundEnd] = string.find(sourceToSearch, searchKey, searchPos);
						} else {
							[foundStart, foundEnd] = string.find(sourceToSearch, searchKey, searchPos, true);
							foundEnd = foundStart !== undefined ? foundStart + searchKey.size() - 1 : undefined;
						}

						if (!foundStart || !foundEnd) break;
						newParts.push(originalSource.sub(lastEnd + 1, foundStart - 1));
						newParts.push(replacement);
						lastEnd = foundEnd;
						searchPos = foundEnd + 1;
						replacementsDone++;
					}
					newParts.push(originalSource.sub(lastEnd + 1));
					const newSource = newParts.join("");

					const [writeSuccess, writeErr] = pcall(() => {
						ScriptEditorService.UpdateSourceAsync(instance, () => newSource);
					});

					if (!writeSuccess) {
						results.push({ scriptPath, matches: matchCount, success: false, error: tostring(writeErr) });
						for (const child of instance.GetChildren()) walkScripts(child);
						return;
					}
				}

				totalReplacements += matchCount;
				scriptsModified++;
				results.push({ scriptPath, matches: matchCount, success: true });
			}
		}

		for (const child of instance.GetChildren()) {
			if (hitLimit) return;
			walkScripts(child);
		}
	}

	const [success, walkErr] = pcall(() => walkScripts(root));

	if (recordingId !== undefined) {
		finishRecording(recordingId, scriptsModified > 0);
	}

	if (!success) return { error: `Failed to search scripts: ${tostring(walkErr)}` };

	return {
		pattern,
		replacement,
		dryRun,
		totalReplacements,
		scriptsModified,
		truncated: hitLimit,
		results,
	};
}

export = {
	getScriptSource,
	setScriptSource,
	editScriptLines,
	insertScriptLines,
	deleteScriptLines,
	findAndReplaceInScripts,
};

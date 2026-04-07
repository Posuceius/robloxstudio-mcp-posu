import Utils from "../Utils";
import Recording from "../Recording";

const { getInstancePath, getInstanceByPath, convertPropertyValue } = Utils;
const { beginRecording, finishRecording } = Recording;

type ProcessedCreateResult =
	| {
		instance: Instance;
		className: string;
		parentPath: string;
	}
	| {
		error: string;
		className?: string;
		parentPath?: string;
	};

type ProcessedBatchResult = {
	results: Record<string, unknown>[];
	successCount: number;
	failureCount: number;
};

function processObjectEntries(
	objects: Record<string, unknown>[],
	createFn: (objData: Record<string, unknown>) => ProcessedCreateResult,
): ProcessedBatchResult {
	const results: Record<string, unknown>[] = [];
	let successCount = 0;
	let failureCount = 0;

	const [loopSuccess, loopError] = pcall(() => {
		for (const entry of objects) {
			if (!typeIs(entry, "table")) {
				failureCount++;
				results.push({ success: false, error: "Each object entry must be a table" });
				continue;
			}

			const objData = entry as Record<string, unknown>;
			const className = objData.className as string;
			const parentPath = objData.parent as string;

			if (!className || !parentPath) {
				failureCount++;
				results.push({ success: false, error: "Class name and parent are required" });
				continue;
			}

			const [entrySuccess, entryResult] = pcall(() => createFn(objData));
			if (!entrySuccess) {
				failureCount++;
				results.push({ success: false, className, parent: parentPath, error: tostring(entryResult) });
				continue;
			}

			if ("instance" in entryResult) {
				successCount++;
				results.push({
					success: true,
					className: entryResult.className,
					parent: entryResult.parentPath,
					instancePath: getInstancePath(entryResult.instance),
					name: entryResult.instance.Name,
				});
			} else {
				failureCount++;
				results.push({
					success: false,
					className: entryResult.className ?? className,
					parent: entryResult.parentPath ?? parentPath,
					error: entryResult.error,
				});
			}
		}
	});

	if (!loopSuccess) {
		failureCount++;
		results.push({ success: false, error: `Unexpected mass create failure: ${tostring(loopError)}` });
	}

	return { results, successCount, failureCount };
}

function createObject(requestData: Record<string, unknown>) {
	const className = requestData.className as string;
	const parentPath = requestData.parent as string;
	const name = requestData.name as string | undefined;
	const properties = (requestData.properties as Record<string, unknown>) ?? {};

	if (!className || !parentPath) {
		return { error: "Class name and parent are required" };
	}

	const parentInstance = getInstanceByPath(parentPath);
	if (!parentInstance) return { error: `Parent instance not found: ${parentPath}` };
	const recordingId = beginRecording(`Create ${className}`);

	const [success, newInstance] = pcall(() => {
		const instance = new Instance(className as keyof CreatableInstances);
		if (name) instance.Name = name;

		for (const [propertyName, propertyValue] of pairs(properties)) {
			pcall(() => {
				const converted = convertPropertyValue(instance, propertyName as string, propertyValue);
				(instance as unknown as { [key: string]: unknown })[propertyName as string] =
					converted !== undefined ? converted : propertyValue;
			});
		}

		instance.Parent = parentInstance;
		return instance;
	});

	if (success && newInstance) {
		finishRecording(recordingId, true);
		return {
			success: true,
			className,
			parent: parentPath,
			instancePath: getInstancePath(newInstance as Instance),
			name: (newInstance as Instance).Name,
			message: "Object created successfully",
		};
	} else {
		finishRecording(recordingId, false);
		return { error: `Failed to create object: ${newInstance}`, className, parent: parentPath };
	}
}

function deleteObject(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	if (!instancePath) return { error: "Instance path is required" };

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };
	if (instance === game) return { error: "Cannot delete the game instance" };
	const recordingId = beginRecording(`Delete ${instance.ClassName} (${instance.Name})`);

	const [success, result] = pcall(() => {
		instance.Destroy();
		return true;
	});

	if (success) {
		finishRecording(recordingId, true);
		return { success: true, instancePath, message: "Object deleted successfully" };
	} else {
		finishRecording(recordingId, false);
		return { error: `Failed to delete object: ${result}`, instancePath };
	}
}

function massCreateObjects(requestData: Record<string, unknown>) {
	const objects = requestData.objects as Record<string, unknown>[];
	if (!objects || !typeIs(objects, "table") || (objects as defined[]).size() === 0) {
		return { error: "Objects array is required" };
	}

	const recordingId = beginRecording("Mass create objects");

	const { results, successCount, failureCount } = processObjectEntries(objects, (objData) => {
		const className = objData.className as string;
		const parentPath = objData.parent as string;
		const name = objData.name as string | undefined;
		const parentInstance = getInstanceByPath(parentPath);
		if (!parentInstance) {
			return { error: "Parent instance not found", className, parentPath };
		}

		const [success, newInstance] = pcall(() => {
			const instance = new Instance(className as keyof CreatableInstances);
			if (name) instance.Name = name;
			instance.Parent = parentInstance;
			return instance;
		});

		if (!success || !newInstance) {
			return { error: tostring(newInstance), className, parentPath };
		}

		return { instance: newInstance as Instance, className, parentPath };
	});

	finishRecording(recordingId, successCount > 0);
	return { results, summary: { total: (objects as defined[]).size(), succeeded: successCount, failed: failureCount } };
}

function massCreateObjectsWithProperties(requestData: Record<string, unknown>) {
	const objects = requestData.objects as Record<string, unknown>[];
	if (!objects || !typeIs(objects, "table") || (objects as defined[]).size() === 0) {
		return { error: "Objects array is required" };
	}

	const recordingId = beginRecording("Mass create objects with properties");

	const { results, successCount, failureCount } = processObjectEntries(objects, (objData) => {
		const className = objData.className as string;
		const parentPath = objData.parent as string;
		const name = objData.name as string | undefined;
		const propertiesRaw = objData.properties;
		const properties = typeIs(propertiesRaw, "table")
			? (propertiesRaw as Record<string, unknown>)
			: ({} as Record<string, unknown>);

		const parentInstance = getInstanceByPath(parentPath);
		if (!parentInstance) {
			return { error: "Parent instance not found", className, parentPath };
		}

		const [success, newInstance] = pcall(() => {
			const instance = new Instance(className as keyof CreatableInstances);
			if (name) instance.Name = name;
			instance.Parent = parentInstance;

			for (const [propName, propValue] of pairs(properties)) {
				pcall(() => {
					const propNameStr = tostring(propName);
					const converted = convertPropertyValue(instance, propNameStr, propValue);
					if (converted !== undefined) {
						(instance as unknown as { [key: string]: unknown })[propNameStr] = converted;
					}
				});
			}
			return instance;
		});

		if (!success || !newInstance) {
			return { error: tostring(newInstance), className, parentPath };
		}

		return { instance: newInstance as Instance, className, parentPath };
	});

	finishRecording(recordingId, successCount > 0);
	return { results, summary: { total: (objects as defined[]).size(), succeeded: successCount, failed: failureCount } };
}

function performSmartDuplicate(requestData: Record<string, unknown>, useRecording = true) {
	const instancePath = requestData.instancePath as string;
	const count = requestData.count as number;
	const options = (requestData.options as Record<string, unknown>) ?? {};

	if (!instancePath || !count || count < 1) {
		return { error: "Instance path and count > 0 are required" };
	}

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };
	const recordingId = useRecording ? beginRecording(`Smart duplicate ${instance.Name}`) : undefined;

	const results: Record<string, unknown>[] = [];
	let successCount = 0;
	let failureCount = 0;

	for (let i = 1; i <= count; i++) {
		const [success, newInstance] = pcall(() => {
			const clone = instance.Clone();

			if (options.namePattern) {
				clone.Name = (options.namePattern as string).gsub("{n}", tostring(i))[0];
			} else {
				clone.Name = instance.Name + i;
			}

			if (options.positionOffset && clone.IsA("BasePart")) {
				const offset = options.positionOffset as number[];
				const currentPos = clone.Position;
				clone.Position = new Vector3(
					currentPos.X + ((offset[0] ?? 0) as number) * i,
					currentPos.Y + ((offset[1] ?? 0) as number) * i,
					currentPos.Z + ((offset[2] ?? 0) as number) * i,
				);
			}

			if (options.rotationOffset && clone.IsA("BasePart")) {
				const offset = options.rotationOffset as number[];
				clone.CFrame = clone.CFrame.mul(CFrame.Angles(
					math.rad(((offset[0] ?? 0) as number) * i),
					math.rad(((offset[1] ?? 0) as number) * i),
					math.rad(((offset[2] ?? 0) as number) * i),
				));
			}

			if (options.scaleOffset && clone.IsA("BasePart")) {
				const offset = options.scaleOffset as number[];
				const currentSize = clone.Size;
				clone.Size = new Vector3(
					currentSize.X * (((offset[0] ?? 1) as number) ** i),
					currentSize.Y * (((offset[1] ?? 1) as number) ** i),
					currentSize.Z * (((offset[2] ?? 1) as number) ** i),
				);
			}

			if (options.propertyVariations) {
				for (const [propName, values] of pairs(options.propertyVariations as Record<string, unknown[]>)) {
					if (values && (values as defined[]).size() > 0) {
						const valueIndex = ((i - 1) % (values as defined[]).size());
						pcall(() => {
							(clone as unknown as { [key: string]: unknown })[propName as string] = (values as unknown[])[valueIndex];
						});
					}
				}
			}

			const targetParents = options.targetParents as string[] | undefined;
			if (targetParents && targetParents[i - 1]) {
				const targetParent = getInstanceByPath(targetParents[i - 1]);
				clone.Parent = targetParent ?? instance.Parent;
			} else {
				clone.Parent = instance.Parent;
			}

			return clone;
		});

		if (success && newInstance) {
			successCount++;
			results.push({
				success: true,
				instancePath: getInstancePath(newInstance as Instance),
				name: (newInstance as Instance).Name,
				index: i,
			});
		} else {
			failureCount++;
			results.push({ success: false, index: i, error: tostring(newInstance) });
		}
	}

	finishRecording(recordingId, successCount > 0);

	return {
		results,
		summary: { total: count, succeeded: successCount, failed: failureCount },
		sourceInstance: instancePath,
	};
}

function smartDuplicate(requestData: Record<string, unknown>) {
	return performSmartDuplicate(requestData, true);
}

function massDuplicate(requestData: Record<string, unknown>) {
	const duplications = requestData.duplications as Record<string, unknown>[];
	if (!duplications || !typeIs(duplications, "table") || (duplications as defined[]).size() === 0) {
		return { error: "Duplications array is required" };
	}

	const allResults: Record<string, unknown>[] = [];
	let totalSuccess = 0;
	let totalFailures = 0;
	const recordingId = beginRecording("Mass duplicate operations");

	for (const duplication of duplications) {
		const result = performSmartDuplicate(duplication, false) as { summary?: { succeeded: number; failed: number } };
		allResults.push(result as unknown as Record<string, unknown>);
		if (result.summary) {
			totalSuccess += result.summary.succeeded;
			totalFailures += result.summary.failed;
		}
	}

	finishRecording(recordingId, totalSuccess > 0);

	return {
		results: allResults,
		summary: { total: totalSuccess + totalFailures, succeeded: totalSuccess, failed: totalFailures },
	};
}

function createUITree(requestData: Record<string, unknown>) {
	const tree = requestData.tree as Record<string, unknown>;
	const parentPath = requestData.parentPath as string;

	if (!tree || !parentPath) {
		return { error: "Tree object and parentPath are required" };
	}

	const parentInstance = getInstanceByPath(parentPath);
	if (!parentInstance) return { error: `Parent not found: ${parentPath}` };

	if (!tree.className || !typeIs(tree.className, "string")) {
		return { error: "Tree root must have a className string" };
	}

	const recordingId = beginRecording("Create UI tree");
	let totalCreated = 0;
	let totalFailed = 0;
	const errors: string[] = [];

	function createNode(nodeData: Record<string, unknown>, nodeParent: Instance): Instance | undefined {
		const className = nodeData.className as string;
		if (!className) {
			totalFailed++;
			errors.push("Node missing className");
			return undefined;
		}

		const [success, instance] = pcall(() => {
			const inst = new Instance(className as keyof CreatableInstances);
			if (nodeData.name) inst.Name = nodeData.name as string;

			const props = nodeData.properties as Record<string, unknown> | undefined;
			if (props && typeIs(props, "table")) {
				for (const [propName, propValue] of pairs(props)) {
					const [propSuccess, propErr] = pcall(() => {
						if (propName === "Name") {
							inst.Name = tostring(propValue);
						} else if (propName === "Source" && inst.IsA("LuaSourceContainer")) {
							(inst as unknown as { Source: string }).Source = tostring(propValue);
						} else {
							const converted = convertPropertyValue(inst, propName as string, propValue);
							if (converted !== undefined) {
								(inst as unknown as Record<string, unknown>)[propName] = converted;
							} else {
								(inst as unknown as Record<string, unknown>)[propName] = propValue;
							}
						}
					});
					if (!propSuccess) {
						errors.push(`${className}.${propName}: ${tostring(propErr)}`);
					}
				}
			}

			inst.Parent = nodeParent;
			return inst;
		});

		if (!success || !instance) {
			totalFailed++;
			errors.push(`Failed to create ${className}: ${tostring(instance)}`);
			return undefined;
		}
		totalCreated++;

		const createdInstance = instance as Instance;

		if (nodeData.cornerRadius !== undefined) {
			const [cornerSuccess, cornerErr] = pcall(() => {
				const corner = new Instance("UICorner");
				const radius = nodeData.cornerRadius;
				if (typeIs(radius, "number")) {
					corner.CornerRadius = new UDim(0, radius);
				} else if (typeIs(radius, "table")) {
					const radiusTbl = radius as Record<string, number>;
					corner.CornerRadius = new UDim(radiusTbl.Scale ?? 0, radiusTbl.Offset ?? 0);
				}
				corner.Parent = createdInstance;
			});
			if (cornerSuccess) { totalCreated++; } else { totalFailed++; errors.push(`UICorner: ${tostring(cornerErr)}`); }
		}

		if (nodeData.padding !== undefined && typeIs(nodeData.padding, "table")) {
			const [paddingSuccess, paddingErr] = pcall(() => {
				const pad = new Instance("UIPadding");
				const paddingData = nodeData.padding as Record<string, unknown>;
				if (paddingData.top !== undefined) pad.PaddingTop = new UDim(0, paddingData.top as number);
				if (paddingData.bottom !== undefined) pad.PaddingBottom = new UDim(0, paddingData.bottom as number);
				if (paddingData.left !== undefined) pad.PaddingLeft = new UDim(0, paddingData.left as number);
				if (paddingData.right !== undefined) pad.PaddingRight = new UDim(0, paddingData.right as number);
				if (paddingData.topScale !== undefined) pad.PaddingTop = new UDim(paddingData.topScale as number, (paddingData.top as number) ?? 0);
				if (paddingData.bottomScale !== undefined) pad.PaddingBottom = new UDim(paddingData.bottomScale as number, (paddingData.bottom as number) ?? 0);
				if (paddingData.leftScale !== undefined) pad.PaddingLeft = new UDim(paddingData.leftScale as number, (paddingData.left as number) ?? 0);
				if (paddingData.rightScale !== undefined) pad.PaddingRight = new UDim(paddingData.rightScale as number, (paddingData.right as number) ?? 0);
				pad.Parent = createdInstance;
			});
			if (paddingSuccess) { totalCreated++; } else { totalFailed++; errors.push(`UIPadding: ${tostring(paddingErr)}`); }
		}

		if (nodeData.stroke !== undefined && typeIs(nodeData.stroke, "table")) {
			const [strokeSuccess, strokeErr] = pcall(() => {
				const stroke = new Instance("UIStroke");
				const strokeData = nodeData.stroke as Record<string, unknown>;
				if (strokeData.color !== undefined) {
					const converted = convertPropertyValue(stroke, "Color", strokeData.color);
					if (converted !== undefined) stroke.Color = converted as Color3;
				}
				if (strokeData.thickness !== undefined) stroke.Thickness = strokeData.thickness as number;
				if (strokeData.transparency !== undefined) stroke.Transparency = strokeData.transparency as number;
				if (strokeData.mode !== undefined) {
					const modeVal = (Enum.ApplyStrokeMode as unknown as Record<string, EnumItem>)[strokeData.mode as string];
					if (modeVal) stroke.ApplyStrokeMode = modeVal as Enum.ApplyStrokeMode;
				}
				stroke.Parent = createdInstance;
			});
			if (strokeSuccess) { totalCreated++; } else { totalFailed++; errors.push(`UIStroke: ${tostring(strokeErr)}`); }
		}

		if (nodeData.gradient !== undefined && typeIs(nodeData.gradient, "table")) {
			const [gradientSuccess, gradientErr] = pcall(() => {
				const gradient = new Instance("UIGradient");
				const gradientData = nodeData.gradient as Record<string, unknown>;
				if (gradientData.rotation !== undefined) gradient.Rotation = gradientData.rotation as number;
				if (gradientData.color !== undefined && typeIs(gradientData.color, "table")) {
					const colorPoints = gradientData.color as unknown[];
					const keypoints: ColorSequenceKeypoint[] = [];
					for (const point of colorPoints) {
						if (typeIs(point, "table")) {
							const pointArr = point as unknown[];
							const time = pointArr[0] as number;
							const colorVal = pointArr[1];
							let color3: Color3;
							if (typeIs(colorVal, "string") && (colorVal as string).sub(1, 1) === "#") {
								const hexStr = (colorVal as string).sub(2);
								color3 = Color3.fromRGB(
									tonumber(hexStr.sub(1, 2), 16) ?? 0,
									tonumber(hexStr.sub(3, 4), 16) ?? 0,
									tonumber(hexStr.sub(5, 6), 16) ?? 0,
								);
							} else if (typeIs(colorVal, "table")) {
								const colorArr = colorVal as number[];
								color3 = new Color3(colorArr[0] ?? 0, colorArr[1] ?? 0, colorArr[2] ?? 0);
							} else {
								color3 = new Color3(1, 1, 1);
							}
							keypoints.push(new ColorSequenceKeypoint(time, color3));
						}
					}
					if (keypoints.size() >= 2) gradient.Color = new ColorSequence(keypoints);
				}
				gradient.Parent = createdInstance;
			});
			if (gradientSuccess) { totalCreated++; } else { totalFailed++; errors.push(`UIGradient: ${tostring(gradientErr)}`); }
		}

		if (nodeData.layout !== undefined && typeIs(nodeData.layout, "table")) {
			const [layoutSuccess, layoutErr] = pcall(() => {
				const layoutData = nodeData.layout as Record<string, unknown>;
				const layoutType = (layoutData.type as string) ?? "list";
				if (layoutType === "grid") {
					const grid = new Instance("UIGridLayout");
					if (layoutData.cellSize !== undefined && typeIs(layoutData.cellSize, "table")) {
						const cellSizeTbl = layoutData.cellSize as Record<string, number>;
						grid.CellSize = new UDim2(cellSizeTbl.XScale ?? 0, cellSizeTbl.XOffset ?? 0, cellSizeTbl.YScale ?? 0, cellSizeTbl.YOffset ?? 0);
					}
					if (layoutData.cellPadding !== undefined && typeIs(layoutData.cellPadding, "table")) {
						const cellPadTbl = layoutData.cellPadding as Record<string, number>;
						grid.CellPadding = new UDim2(cellPadTbl.XScale ?? 0, cellPadTbl.XOffset ?? 0, cellPadTbl.YScale ?? 0, cellPadTbl.YOffset ?? 0);
					}
					if (layoutData.sortOrder !== undefined) grid.SortOrder = Enum.SortOrder.LayoutOrder;
					grid.Parent = createdInstance;
				} else {
					const list = new Instance("UIListLayout");
					if (layoutData.direction === "Horizontal") {
						list.FillDirection = Enum.FillDirection.Horizontal;
					} else {
						list.FillDirection = Enum.FillDirection.Vertical;
					}
					if (layoutData.padding !== undefined) {
						if (typeIs(layoutData.padding, "number")) {
							list.Padding = new UDim(0, layoutData.padding as number);
						}
					}
					if (layoutData.horizontalAlignment !== undefined) {
						const alignVal = (Enum.HorizontalAlignment as unknown as Record<string, EnumItem>)[layoutData.horizontalAlignment as string];
						if (alignVal) list.HorizontalAlignment = alignVal as Enum.HorizontalAlignment;
					}
					if (layoutData.verticalAlignment !== undefined) {
						const alignVal = (Enum.VerticalAlignment as unknown as Record<string, EnumItem>)[layoutData.verticalAlignment as string];
						if (alignVal) list.VerticalAlignment = alignVal as Enum.VerticalAlignment;
					}
					if (layoutData.sortOrder !== undefined) list.SortOrder = Enum.SortOrder.LayoutOrder;
					list.Parent = createdInstance;
				}
			});
			if (layoutSuccess) { totalCreated++; } else { totalFailed++; errors.push(`UILayout: ${tostring(layoutErr)}`); }
		}

		if (nodeData.aspectRatio !== undefined && typeIs(nodeData.aspectRatio, "table")) {
			const [aspectSuccess, aspectErr] = pcall(() => {
				const aspect = new Instance("UIAspectRatioConstraint");
				const aspectData = nodeData.aspectRatio as Record<string, unknown>;
				if (aspectData.value !== undefined) aspect.AspectRatio = aspectData.value as number;
				if (aspectData.type !== undefined) {
					const typeVal = (Enum.AspectType as unknown as Record<string, EnumItem>)[aspectData.type as string];
					if (typeVal) aspect.AspectType = typeVal as Enum.AspectType;
				}
				if (aspectData.dominantAxis !== undefined) {
					const axisVal = (Enum.DominantAxis as unknown as Record<string, EnumItem>)[aspectData.dominantAxis as string];
					if (axisVal) aspect.DominantAxis = axisVal as Enum.DominantAxis;
				}
				aspect.Parent = createdInstance;
			});
			if (aspectSuccess) { totalCreated++; } else { totalFailed++; errors.push(`UIAspectRatioConstraint: ${tostring(aspectErr)}`); }
		}

		if (nodeData.sizeConstraint !== undefined && typeIs(nodeData.sizeConstraint, "table")) {
			const [sizeConSuccess, sizeConErr] = pcall(() => {
				const sizeCon = new Instance("UISizeConstraint");
				const sizeConData = nodeData.sizeConstraint as Record<string, unknown>;
				if (sizeConData.minSize !== undefined && typeIs(sizeConData.minSize, "table")) {
					const minArr = sizeConData.minSize as number[];
					sizeCon.MinSize = new Vector2(minArr[0] ?? 0, minArr[1] ?? 0);
				}
				if (sizeConData.maxSize !== undefined && typeIs(sizeConData.maxSize, "table")) {
					const maxArr = sizeConData.maxSize as number[];
					sizeCon.MaxSize = new Vector2(maxArr[0] ?? math.huge, maxArr[1] ?? math.huge);
				}
				sizeCon.Parent = createdInstance;
			});
			if (sizeConSuccess) { totalCreated++; } else { totalFailed++; errors.push(`UISizeConstraint: ${tostring(sizeConErr)}`); }
		}

		if (nodeData.scale !== undefined && typeIs(nodeData.scale, "number")) {
			const [scaleSuccess, scaleErr] = pcall(() => {
				const scaleInst = new Instance("UIScale");
				scaleInst.Scale = nodeData.scale as number;
				scaleInst.Parent = createdInstance;
			});
			if (scaleSuccess) { totalCreated++; } else { totalFailed++; errors.push(`UIScale: ${tostring(scaleErr)}`); }
		}

		const children = nodeData.children as Record<string, unknown>[] | undefined;
		if (children && typeIs(children, "table")) {
			for (const childData of children) {
				if (typeIs(childData, "table")) {
					createNode(childData as Record<string, unknown>, instance as Instance);
				}
			}
		}

		return instance as Instance;
	}

	const rootInstance = createNode(tree, parentInstance);

	finishRecording(recordingId, totalCreated > 0);

	if (!rootInstance) {
		return {
			success: false,
			error: `Failed to create root node (${tree.className})`,
			totalCreated,
			totalFailed,
			errors,
		};
	}

	return {
		success: true,
		totalCreated,
		totalFailed,
		rootPath: getInstancePath(rootInstance),
		message: `Created ${totalCreated} instances${totalFailed > 0 ? `, ${totalFailed} failed` : ""}`,
		errors: errors.size() > 0 ? errors : undefined,
	};
}

function cloneObject(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const targetParentPath = requestData.targetParentPath as string;

	if (!instancePath || !targetParentPath) {
		return { error: "Instance path and target parent path are required" };
	}

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };

	const targetParent = getInstanceByPath(targetParentPath);
	if (!targetParent) return { error: `Target parent not found: ${targetParentPath}` };

	const recordingId = beginRecording(`Clone ${instance.Name}`);

	const [success, clone] = pcall(() => {
		const cloned = instance.Clone();
		cloned.Parent = targetParent;
		return cloned;
	});

	if (success && clone) {
		finishRecording(recordingId, true);
		return {
			success: true,
			instancePath: getInstancePath(clone as Instance),
			name: (clone as Instance).Name,
			className: (clone as Instance).ClassName,
			parent: targetParentPath,
			message: "Object cloned successfully",
		};
	}
	finishRecording(recordingId, false);
	return { error: `Failed to clone object: ${clone}` };
}

function moveObject(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const targetParentPath = requestData.targetParentPath as string;

	if (!instancePath || !targetParentPath) {
		return { error: "Instance path and target parent path are required" };
	}

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };

	const targetParent = getInstanceByPath(targetParentPath);
	if (!targetParent) return { error: `Target parent not found: ${targetParentPath}` };

	const recordingId = beginRecording(`Move ${instance.Name}`);

	const [success, result] = pcall(() => {
		instance.Parent = targetParent;
		return true;
	});

	if (success) {
		finishRecording(recordingId, true);
		return {
			success: true,
			instancePath: getInstancePath(instance),
			name: instance.Name,
			className: instance.ClassName,
			parent: targetParentPath,
			message: "Object moved successfully",
		};
	}
	finishRecording(recordingId, false);
	return { error: `Failed to move object: ${result}` };
}

export = {
	createObject,
	createUITree,
	deleteObject,
	massCreateObjects,
	smartDuplicate,
	massDuplicate,
	cloneObject,
	moveObject,
};

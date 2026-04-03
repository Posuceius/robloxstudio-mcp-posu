import Utils from "../Utils";

const { getInstancePath, getInstanceByPath, readScriptSource } = Utils;

interface TreeNode {
	name: string;
	className: string;
	path?: string;
	children: TreeNode[];
	hasSource?: boolean;
	scriptType?: string;
	enabled?: boolean;
}

function getFileTree(requestData: Record<string, unknown>) {
	const path = (requestData.path as string) ?? "";
	const startInstance = getInstanceByPath(path);

	if (!startInstance) {
		return { error: `Path not found: ${path}` };
	}

	function buildTree(instance: Instance, depth: number): TreeNode {
		if (depth > 10) {
			return { name: instance.Name, className: instance.ClassName, children: [] };
		}

		const node: TreeNode = {
			name: instance.Name,
			className: instance.ClassName,
			path: getInstancePath(instance),
			children: [],
		};

		if (instance.IsA("LuaSourceContainer")) {
			node.hasSource = true;
			node.scriptType = instance.ClassName;
			if (instance.IsA("BaseScript")) {
				node.enabled = instance.Enabled;
			}
		}

		for (const child of instance.GetChildren()) {
			node.children.push(buildTree(child, depth + 1));
		}

		return node;
	}

	return {
		tree: buildTree(startInstance, 0),
		timestamp: tick(),
	};
}

function searchFiles(requestData: Record<string, unknown>) {
	const query = requestData.query as string;
	const searchType = (requestData.searchType as string) ?? "name";

	if (!query) return { error: "Query is required" };

	const results: { name: string; className: string; path: string; hasSource: boolean; enabled?: boolean }[] = [];

	function searchRecursive(instance: Instance) {
		let match = false;

		if (searchType === "name") {
			match = instance.Name.lower().find(query.lower())[0] !== undefined;
		} else if (searchType === "type") {
			match = instance.ClassName.lower().find(query.lower())[0] !== undefined;
		} else if (searchType === "content" && instance.IsA("LuaSourceContainer")) {
			match = readScriptSource(instance).lower().find(query.lower())[0] !== undefined;
		}

		if (match) {
			const entry: { name: string; className: string; path: string; hasSource: boolean; enabled?: boolean } = {
				name: instance.Name,
				className: instance.ClassName,
				path: getInstancePath(instance),
				hasSource: instance.IsA("LuaSourceContainer"),
			};
			if (instance.IsA("BaseScript")) {
				entry.enabled = instance.Enabled;
			}
			results.push(entry);
		}

		for (const child of instance.GetChildren()) {
			searchRecursive(child);
		}
	}

	searchRecursive(game);

	return { results, query, searchType, count: results.size() };
}

function getPlaceInfo(_requestData: Record<string, unknown>) {
	return {
		placeName: game.Name,
		placeId: game.PlaceId,
		gameId: game.GameId,
		jobId: game.JobId,
		workspace: {
			name: game.Workspace.Name,
			className: game.Workspace.ClassName,
		},
	};
}

function getServices(requestData: Record<string, unknown>) {
	const serviceName = requestData.serviceName as string | undefined;

	if (serviceName) {
		const [ok, service] = pcall(() => game.GetService(serviceName as keyof Services));
		if (ok && service) {
			return {
				service: {
					name: service.Name,
					className: service.ClassName,
					path: getInstancePath(service as Instance),
					childCount: (service as Instance).GetChildren().size(),
				},
			};
		} else {
			return { error: `Service not found: ${serviceName}` };
		}
	} else {
		const services: { name: string; className: string; path: string; childCount: number }[] = [];
		const commonServices = [
			"Workspace", "Players", "StarterGui", "StarterPack", "StarterPlayer",
			"ReplicatedStorage", "ServerStorage", "ServerScriptService",
			"HttpService", "TeleportService", "DataStoreService",
		];

		for (const svcName of commonServices) {
			const [ok, service] = pcall(() => game.GetService(svcName as keyof Services));
			if (ok && service) {
				services.push({
					name: service.Name,
					className: service.ClassName,
					path: getInstancePath(service as Instance),
					childCount: (service as Instance).GetChildren().size(),
				});
			}
		}

		return { services };
	}
}

function searchObjects(requestData: Record<string, unknown>) {
	const query = requestData.query as string;
	const searchType = (requestData.searchType as string) ?? "name";
	const propertyName = requestData.propertyName as string | undefined;

	if (!query) return { error: "Query is required" };

	const results: { name: string; className: string; path: string }[] = [];

	function searchRecursive(instance: Instance) {
		let match = false;

		if (searchType === "name") {
			match = instance.Name.lower().find(query.lower())[0] !== undefined;
		} else if (searchType === "class") {
			match = instance.ClassName.lower().find(query.lower())[0] !== undefined;
		} else if (searchType === "property" && propertyName) {
			const [success, value] = pcall(() => tostring((instance as unknown as Record<string, unknown>)[propertyName]));
			if (success) {
				match = (value as string).lower().find(query.lower())[0] !== undefined;
			}
		}

		if (match) {
			results.push({
				name: instance.Name,
				className: instance.ClassName,
				path: getInstancePath(instance),
			});
		}

		for (const child of instance.GetChildren()) {
			searchRecursive(child);
		}
	}

	searchRecursive(game);

	return { results, query, searchType, count: results.size() };
}

const UI_DEFAULT_VALUES: Record<string, unknown> = {
	BackgroundTransparency: "0",
	BorderSizePixel: "0",
	Visible: "true",
	ZIndex: "1",
	LayoutOrder: "0",
	Rotation: "0",
	ClipsDescendants: "false",
	RichText: "false",
	TextWrapped: "false",
	TextScaled: "false",
	TextTransparency: "0",
	ImageTransparency: "0",
	ResetOnSpawn: "true",
	Active: "false",
};

function serializeValue(val: unknown, propName: string): unknown {
	if (typeOf(val) === "UDim2") {
		const udim = val as UDim2;
		return { XScale: udim.X.Scale, XOffset: udim.X.Offset, YScale: udim.Y.Scale, YOffset: udim.Y.Offset };
	}
	if (typeOf(val) === "UDim") {
		const udim = val as UDim;
		return { Scale: udim.Scale, Offset: udim.Offset };
	}
	if (typeOf(val) === "Color3") {
		const color = val as Color3;
		return { R: math.floor(color.R * 255), G: math.floor(color.G * 255), B: math.floor(color.B * 255) };
	}
	if (typeOf(val) === "Vector2") {
		const vec = val as Vector2;
		return { X: vec.X, Y: vec.Y };
	}
	if (typeOf(val) === "Vector3") {
		const vec = val as Vector3;
		return { X: vec.X, Y: vec.Y, Z: vec.Z };
	}
	return tostring(val);
}

function tryReadProp(instance: Instance, propName: string): unknown {
	const [propSuccess, propValue] = pcall(() => (instance as unknown as Record<string, unknown>)[propName]);
	if (propSuccess && propValue !== undefined) return serializeValue(propValue, propName);
	return undefined;
}

function getInstanceProperties(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const excludeSource = (requestData.excludeSource as boolean) ?? false;
	const stripDefaults = (requestData.stripDefaults as boolean) ?? false;
	if (!instancePath) return { error: "Instance path is required" };

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };

	const properties: Record<string, unknown> = {};
	const [success, result] = pcall(() => {
		properties.Name = instance.Name;
		properties.ClassName = instance.ClassName;
		const parentInst = instance.Parent;
		if (parentInst) properties.Parent = getInstancePath(parentInst);

		const commonProps = [
			"Size", "Position", "Rotation", "CFrame", "Anchored", "CanCollide",
			"Transparency", "BrickColor", "Material", "Color", "Text", "TextColor3",
			"BackgroundColor3", "Image", "ImageColor3", "Visible", "Active", "ZIndex",
			"BorderSizePixel", "BackgroundTransparency", "ImageTransparency",
			"TextTransparency", "Value", "Enabled", "Brightness", "Range", "Shadows",
			"Face", "SurfaceType",
		];

		for (const prop of commonProps) {
			const val = tryReadProp(instance, prop);
			if (val !== undefined) properties[prop] = val;
		}

		if (instance.IsA("GuiObject")) {
			const guiProps = [
				"AnchorPoint", "AutomaticSize", "BorderColor3",
				"SizeConstraint", "LayoutOrder", "ClipsDescendants",
			];
			for (const prop of guiProps) {
				const val = tryReadProp(instance, prop);
				if (val !== undefined) properties[prop] = val;
			}
		}

		if (instance.IsA("TextLabel") || instance.IsA("TextButton") || instance.IsA("TextBox")) {
			const textProps = ["TextSize", "TextXAlignment", "TextYAlignment", "Font", "FontFace", "RichText", "TextWrapped", "TextScaled", "LineHeight"];
			for (const prop of textProps) {
				const val = tryReadProp(instance, prop);
				if (val !== undefined) properties[prop] = val;
			}
		}

		if (instance.IsA("ImageLabel") || instance.IsA("ImageButton")) {
			const imageProps = ["ScaleType", "SliceCenter", "TileSize", "ImageRectOffset", "ImageRectSize"];
			for (const prop of imageProps) {
				const val = tryReadProp(instance, prop);
				if (val !== undefined) properties[prop] = val;
			}
		}

		if (instance.IsA("ScrollingFrame")) {
			const scrollProps = ["CanvasSize", "CanvasPosition", "ScrollBarThickness", "ScrollBarImageColor3", "ScrollingDirection", "ElasticBehavior"];
			for (const prop of scrollProps) {
				const val = tryReadProp(instance, prop);
				if (val !== undefined) properties[prop] = val;
			}
		}

		if (instance.IsA("UICorner")) {
			properties.CornerRadius = tryReadProp(instance, "CornerRadius");
		}
		if (instance.IsA("UIStroke")) {
			for (const prop of ["Color", "Thickness", "Transparency", "ApplyStrokeMode"]) {
				const val = tryReadProp(instance, prop);
				if (val !== undefined) properties[prop] = val;
			}
		}
		if (instance.IsA("UIPadding")) {
			for (const prop of ["PaddingTop", "PaddingBottom", "PaddingLeft", "PaddingRight"]) {
				const val = tryReadProp(instance, prop);
				if (val !== undefined) properties[prop] = val;
			}
		}
		if (instance.IsA("UIListLayout")) {
			for (const prop of ["FillDirection", "HorizontalAlignment", "VerticalAlignment", "Padding", "SortOrder"]) {
				const val = tryReadProp(instance, prop);
				if (val !== undefined) properties[prop] = val;
			}
		}
		if (instance.IsA("UIGridLayout")) {
			for (const prop of ["CellPadding", "CellSize", "FillDirection", "SortOrder", "FillDirectionMaxCells"]) {
				const val = tryReadProp(instance, prop);
				if (val !== undefined) properties[prop] = val;
			}
		}
		if (instance.ClassName === "UIAspectRatioConstraint") {
			for (const prop of ["AspectRatio", "AspectType", "DominantAxis"]) {
				const val = tryReadProp(instance, prop);
				if (val !== undefined) properties[prop] = val;
			}
		}
		if (instance.ClassName === "UIScale") {
			properties.Scale = tryReadProp(instance, "Scale");
		}
		if (instance.ClassName === "UISizeConstraint") {
			for (const prop of ["MinSize", "MaxSize"]) {
				const val = tryReadProp(instance, prop);
				if (val !== undefined) properties[prop] = val;
			}
		}
		if (instance.ClassName === "UIGradient") {
			for (const prop of ["Rotation", "Transparency"]) {
				const val = tryReadProp(instance, prop);
				if (val !== undefined) properties[prop] = val;
			}
		}

		if (instance.IsA("ScreenGui")) {
			for (const prop of ["IgnoreGuiInset", "DisplayOrder", "ResetOnSpawn"]) {
				const val = tryReadProp(instance, prop);
				if (val !== undefined) properties[prop] = val;
			}
		}

		if (instance.IsA("LuaSourceContainer")) {
			if (!excludeSource) {
				properties.Source = readScriptSource(instance);
			} else {
				const src = readScriptSource(instance);
				properties.SourceLength = src.size();
				properties.LineCount = Utils.splitLines(src)[0].size();
			}
			if (instance.IsA("BaseScript")) {
				properties.Enabled = tostring(instance.Enabled);
			}
		}

		if (instance.IsA("Part")) properties.Shape = tostring(instance.Shape);
		if (instance.IsA("BasePart")) {
			properties.TopSurface = tostring(instance.TopSurface);
			properties.BottomSurface = tostring(instance.BottomSurface);
		}
		if (instance.IsA("MeshPart")) {
			properties.MeshId = tostring(instance.MeshId);
			properties.TextureID = tostring(instance.TextureID);
		}
		if (instance.IsA("SpecialMesh")) {
			properties.MeshId = tostring(instance.MeshId);
			properties.TextureId = tostring(instance.TextureId);
			properties.MeshType = tostring(instance.MeshType);
		}
		if (instance.IsA("Sound")) {
			properties.SoundId = tostring(instance.SoundId);
			properties.TimeLength = tostring(instance.TimeLength);
			properties.IsPlaying = tostring(instance.IsPlaying);
		}
		if (instance.IsA("Animation")) properties.AnimationId = tostring(instance.AnimationId);
		if (instance.IsA("Decal") || instance.IsA("Texture")) {
			properties.Texture = tostring((instance as Decal | Texture).Texture);
		}
		if (instance.IsA("Shirt")) properties.ShirtTemplate = tostring(instance.ShirtTemplate);
		else if (instance.IsA("Pants")) properties.PantsTemplate = tostring(instance.PantsTemplate);
		else if (instance.IsA("ShirtGraphic")) properties.Graphic = tostring(instance.Graphic);

		properties.ChildCount = tostring(instance.GetChildren().size());
	});

	if (!success) return { error: `Failed to get properties: ${result}` };

	if (stripDefaults) {
		for (const [key, defaultVal] of pairs(UI_DEFAULT_VALUES)) {
			if (properties[key] === defaultVal) {
				delete properties[key as string];
			}
		}
	}

	return { instancePath, className: instance.ClassName, properties };
}

function extractUIStyle(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	if (!instancePath) return { error: "Instance path is required" };

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };

	const colorCounts: Record<string, number> = {};
	const fontCounts: Record<string, number> = {};
	const cornerRadii: Record<string, number> = {};
	const strokePatterns: Record<string, number> = {};
	const spacingValues: Record<string, number> = {};
	const transparencyValues: Record<string, number> = {};
	const imageAssets: Record<string, string> = {};

	function colorKey(color: Color3): string {
		const red = math.floor(color.R * 255);
		const green = math.floor(color.G * 255);
		const blue = math.floor(color.B * 255);
		return `${red},${green},${blue}`;
	}

	function walkTree(inst: Instance) {
		const instRecord = inst as unknown as Record<string, unknown>;

		const [bgSuccess, bgColor] = pcall(() => instRecord.BackgroundColor3);
		if (bgSuccess && typeOf(bgColor) === "Color3") {
			const key = colorKey(bgColor as Color3);
			const bgTransVal = instRecord.BackgroundTransparency as number;
			if (bgTransVal === undefined || bgTransVal < 1) {
				colorCounts[key] = (colorCounts[key] ?? 0) + 1;
			}
		}

		const [textColorSuccess, textColor] = pcall(() => instRecord.TextColor3);
		if (textColorSuccess && typeOf(textColor) === "Color3") {
			const key = colorKey(textColor as Color3);
			colorCounts[key] = (colorCounts[key] ?? 0) + 1;
		}

		const [fontSuccess, fontVal] = pcall(() => instRecord.Font);
		if (fontSuccess && fontVal !== undefined) {
			const fontStr = tostring(fontVal);
			fontCounts[fontStr] = (fontCounts[fontStr] ?? 0) + 1;
		}

		const [imageSuccess, imageVal] = pcall(() => instRecord.Image);
		if (imageSuccess && typeIs(imageVal, "string") && (imageVal as string).size() > 0) {
			const imageSrc = imageVal as string;
			imageAssets[imageSrc] = inst.ClassName;
		}

		if (inst.IsA("UICorner")) {
			const [crSuccess, crVal] = pcall(() => (inst as UICorner).CornerRadius);
			if (crSuccess) {
				const key = `${(crVal as UDim).Scale},${(crVal as UDim).Offset}`;
				cornerRadii[key] = (cornerRadii[key] ?? 0) + 1;
			}
		}

		if (inst.IsA("UIStroke")) {
			const [strokeSuccess] = pcall(() => {
				const stroke = inst as UIStroke;
				const key = `${stroke.Thickness}|${colorKey(stroke.Color)}`;
				strokePatterns[key] = (strokePatterns[key] ?? 0) + 1;
			});
		}

		if (inst.IsA("UIPadding")) {
			const [padSuccess] = pcall(() => {
				const pad = inst as UIPadding;
				for (const side of ["PaddingTop", "PaddingBottom", "PaddingLeft", "PaddingRight"] as const) {
					const udim = pad[side];
					const key = `${udim.Offset}`;
					spacingValues[key] = (spacingValues[key] ?? 0) + 1;
				}
			});
		}

		if (inst.IsA("UIListLayout")) {
			const [listSuccess] = pcall(() => {
				const layout = inst as UIListLayout;
				const key = `${layout.Padding.Offset}`;
				spacingValues[key] = (spacingValues[key] ?? 0) + 1;
			});
		}

		const [btSuccess, btVal] = pcall(() => instRecord.BackgroundTransparency);
		if (btSuccess && typeIs(btVal, "number") && (btVal as number) > 0 && (btVal as number) < 1) {
			const key = tostring(btVal);
			transparencyValues[key] = (transparencyValues[key] ?? 0) + 1;
		}

		for (const child of inst.GetChildren()) {
			walkTree(child);
		}
	}

	const [success, walkError] = pcall(() => walkTree(instance));
	if (!success) return { error: `Failed to extract style: ${tostring(walkError)}` };

	const sortedColors: Record<string, unknown>[] = [];
	for (const [key, count] of pairs(colorCounts)) {
		const parts = (key as string).split(",");
		sortedColors.push({
			rgb: key,
			red: tonumber(parts[0]) ?? 0,
			green: tonumber(parts[1]) ?? 0,
			blue: tonumber(parts[2]) ?? 0,
			count: count,
		});
	}
	table.sort(sortedColors, (colorA, colorB) => (colorA.count as number) > (colorB.count as number));

	const sortedFonts: Record<string, unknown>[] = [];
	for (const [key, count] of pairs(fontCounts)) {
		sortedFonts.push({ font: key, count: count });
	}
	table.sort(sortedFonts, (fontA, fontB) => (fontA.count as number) > (fontB.count as number));

	const sortedRadii: Record<string, unknown>[] = [];
	for (const [key, count] of pairs(cornerRadii)) {
		const parts = (key as string).split(",");
		sortedRadii.push({ scale: tonumber(parts[0]) ?? 0, offset: tonumber(parts[1]) ?? 0, count: count });
	}

	const sortedStrokes: Record<string, unknown>[] = [];
	for (const [key, count] of pairs(strokePatterns)) {
		const parts = (key as string).split("|");
		sortedStrokes.push({ thickness: tonumber(parts[0]) ?? 0, color: parts[1], count: count });
	}

	const sortedSpacing: Record<string, unknown>[] = [];
	for (const [key, count] of pairs(spacingValues)) {
		sortedSpacing.push({ offset: tonumber(key) ?? 0, count: count });
	}
	table.sort(sortedSpacing, (spacingA, spacingB) => (spacingA.count as number) > (spacingB.count as number));

	const sortedTransparencies: Record<string, unknown>[] = [];
	for (const [key, count] of pairs(transparencyValues)) {
		sortedTransparencies.push({ value: tonumber(key) ?? 0, count: count });
	}

	const imageList: Record<string, unknown>[] = [];
	for (const [assetId, className] of pairs(imageAssets)) {
		imageList.push({ assetId: assetId, className: className });
	}

	return {
		instancePath,
		className: instance.ClassName,
		tokens: {
			colors: sortedColors,
			fonts: sortedFonts,
			cornerRadii: sortedRadii,
			strokes: sortedStrokes,
			spacing: sortedSpacing,
			transparencies: sortedTransparencies,
			images: imageList,
		},
	};
}

function getInstanceChildren(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	if (!instancePath) return { error: "Instance path is required" };

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };

	const children: { name: string; className: string; path: string; hasChildren: boolean; hasSource: boolean; enabled?: boolean }[] = [];
	for (const child of instance.GetChildren()) {
		const entry: { name: string; className: string; path: string; hasChildren: boolean; hasSource: boolean; enabled?: boolean } = {
			name: child.Name,
			className: child.ClassName,
			path: getInstancePath(child),
			hasChildren: child.GetChildren().size() > 0,
			hasSource: child.IsA("LuaSourceContainer"),
		};
		if (child.IsA("BaseScript")) {
			entry.enabled = child.Enabled;
		}
		children.push(entry);
	}

	return { instancePath, children, count: children.size() };
}

function searchByProperty(requestData: Record<string, unknown>) {
	const propertyName = requestData.propertyName as string;
	const propertyValue = requestData.propertyValue as string;

	if (!propertyName || !propertyValue) {
		return { error: "Property name and value are required" };
	}

	const results: { name: string; className: string; path: string; propertyValue: string }[] = [];

	function searchRecursive(instance: Instance) {
		const [success, value] = pcall(() => tostring((instance as unknown as Record<string, unknown>)[propertyName]));
		if (success && (value as string).lower().find(propertyValue.lower())[0] !== undefined) {
			results.push({
				name: instance.Name,
				className: instance.ClassName,
				path: getInstancePath(instance),
				propertyValue: value as string,
			});
		}
		for (const child of instance.GetChildren()) {
			searchRecursive(child);
		}
	}

	searchRecursive(game);
	return { propertyName, propertyValue, results, count: results.size() };
}

function getClassInfo(requestData: Record<string, unknown>) {
	const className = requestData.className as string;
	if (!className) return { error: "Class name is required" };

	let [success, tempInstance] = pcall(() => new Instance(className as keyof CreatableInstances));
	let isService = false;

	if (!success) {
		const [serviceSuccess, serviceInstance] = pcall(() =>
			game.GetService(className as keyof Services),
		);
		if (serviceSuccess && serviceInstance) {
			success = true;
			tempInstance = serviceInstance as unknown as Instance;
			isService = true;
		}
	}

	if (!success) return { error: `Invalid class name: ${className}` };

	const classInfo: {
		className: string;
		isService: boolean;
		properties: string[];
		methods: string[];
		events: string[];
	} = { className, isService, properties: [], methods: [], events: [] };

	const commonProps = [
		"Name", "ClassName", "Parent", "Size", "Position", "Rotation", "CFrame",
		"Anchored", "CanCollide", "Transparency", "BrickColor", "Material", "Color",
		"Text", "TextColor3", "BackgroundColor3", "Image", "ImageColor3", "Visible",
		"Active", "ZIndex", "BorderSizePixel", "BackgroundTransparency",
		"ImageTransparency", "TextTransparency", "Value", "Enabled", "Brightness",
		"Range", "Shadows",
	];

	for (const prop of commonProps) {
		const [propSuccess] = pcall(() => (tempInstance as unknown as Record<string, unknown>)[prop]);
		if (propSuccess) classInfo.properties.push(prop);
	}

	const commonMethods = [
		"Destroy", "Clone", "FindFirstChild", "FindFirstChildOfClass",
		"GetChildren", "IsA", "IsAncestorOf", "IsDescendantOf", "WaitForChild",
	];

	for (const method of commonMethods) {
		const [methodSuccess] = pcall(() => (tempInstance as unknown as Record<string, unknown>)[method]);
		if (methodSuccess) classInfo.methods.push(method);
	}

	if (!isService) {
		(tempInstance as Instance).Destroy();
	}

	return classInfo;
}

function getProjectStructure(requestData: Record<string, unknown>) {
	const startPath = (requestData.path as string) ?? "";
	const maxDepth = (requestData.maxDepth as number) ?? 3;
	const showScriptsOnly = (requestData.scriptsOnly as boolean) ?? false;

	if (startPath === "" || startPath === "game") {
		const services: Record<string, unknown>[] = [];
		const mainServices = [
			"Workspace", "ServerScriptService", "ServerStorage", "ReplicatedStorage",
			"StarterGui", "StarterPack", "StarterPlayer", "Players",
		];

		for (const serviceName of mainServices) {
			const [svcOk, service] = pcall(() => game.GetService(serviceName as keyof Services));
			if (svcOk && service) {
				services.push({
					name: service.Name,
					className: service.ClassName,
					path: getInstancePath(service as Instance),
					childCount: (service as Instance).GetChildren().size(),
					hasChildren: (service as Instance).GetChildren().size() > 0,
				});
			}
		}

		return {
			type: "service_overview",
			services,
			timestamp: tick(),
			note: "Use path parameter to explore specific locations (e.g., 'game.ServerScriptService')",
		};
	}

	const startInstance = getInstanceByPath(startPath);
	if (!startInstance) return { error: `Path not found: ${startPath}` };

	function getStructure(instance: Instance, depth: number): Record<string, unknown> {
		if (depth > maxDepth) {
			return {
				name: instance.Name,
				className: instance.ClassName,
				path: getInstancePath(instance),
				childCount: instance.GetChildren().size(),
				hasMore: true,
				note: "Max depth reached - use this path to explore further",
			};
		}

		const node: Record<string, unknown> = {
			name: instance.Name,
			className: instance.ClassName,
			path: getInstancePath(instance),
			children: [] as Record<string, unknown>[],
		};

		if (instance.IsA("LuaSourceContainer")) {
			node.hasSource = true;
			node.scriptType = instance.ClassName;
			if (instance.IsA("BaseScript")) {
				node.enabled = instance.Enabled;
			}
		}

		if (instance.IsA("GuiObject")) {
			node.visible = instance.Visible;
			if (instance.IsA("Frame") || instance.IsA("ScreenGui")) {
				node.guiType = "container";
			} else if (instance.IsA("TextLabel") || instance.IsA("TextButton")) {
				node.guiType = "text";
				const textInst = instance as TextLabel | TextButton;
				if (textInst.Text !== "") node.text = textInst.Text;
			} else if (instance.IsA("ImageLabel") || instance.IsA("ImageButton")) {
				node.guiType = "image";
			}
		}

		let children = instance.GetChildren();
		if (showScriptsOnly) {
			children = children.filter(
				(child) => child.IsA("BaseScript") || child.IsA("Folder") || child.IsA("ModuleScript"),
			);
		}

		const nodeChildren = node.children as Record<string, unknown>[];
		const childCount = children.size();
		if (childCount > 20 && depth < maxDepth) {
			const classGroups = new Map<string, Instance[]>();
			for (const child of children) {
				const cn = child.ClassName;
				if (!classGroups.has(cn)) classGroups.set(cn, []);
				classGroups.get(cn)!.push(child);
			}

			const childSummary: Record<string, unknown>[] = [];
			classGroups.forEach((classChildren, cn) => {
				childSummary.push({
					className: cn,
					count: classChildren.size(),
					examples: [classChildren[0]?.Name, classChildren[1]?.Name],
				});
			});
			node.childSummary = childSummary;

			classGroups.forEach((classChildren, cn) => {
				const limit = math.min(3, classChildren.size());
				for (let i = 0; i < limit; i++) {
					nodeChildren.push(getStructure(classChildren[i], depth + 1));
				}
				if (classChildren.size() > 3) {
					nodeChildren.push({
						name: `... ${classChildren.size() - 3} more ${cn} objects`,
						className: "MoreIndicator",
						path: `${getInstancePath(instance)} [${cn} children]`,
						note: "Use specific path to explore these objects",
					});
				}
			});
		} else {
			for (const child of children) {
				nodeChildren.push(getStructure(child, depth + 1));
			}
		}

		return node;
	}

	const result = getStructure(startInstance, 0);
	result.requestedPath = startPath;
	result.maxDepth = maxDepth;
	result.scriptsOnly = showScriptsOnly;
	result.timestamp = tick();

	return result;
}

function grepScripts(requestData: Record<string, unknown>) {
	const pattern = requestData.pattern as string;
	if (!pattern) return { error: "pattern is required" };

	const caseSensitive = (requestData.caseSensitive as boolean) ?? false;
	const contextLines = (requestData.contextLines as number) ?? 0;
	const maxResults = (requestData.maxResults as number) ?? 100;
	const maxResultsPerScript = (requestData.maxResultsPerScript as number) ?? 0;
	const usePattern = (requestData.usePattern as boolean) ?? false;
	const filesOnly = (requestData.filesOnly as boolean) ?? false;
	const searchPath = (requestData.path as string) ?? "";
	const classFilter = requestData.classFilter as string | undefined;

	const startInstance = searchPath !== "" ? getInstanceByPath(searchPath) : game;
	if (!startInstance) return { error: `Path not found: ${searchPath}` };

	// Prepare pattern for matching
	const searchPattern = caseSensitive ? pattern : pattern.lower();

	interface LineMatch {
		line: number;
		column: number;
		text: string;
		before: string[];
		after: string[];
	}

	interface ScriptResult {
		instancePath: string;
		name: string;
		className: string;
		enabled?: boolean;
		matches: LineMatch[];
	}

	const results: ScriptResult[] = [];
	let totalMatches = 0;
	let scriptsSearched = 0;
	let hitLimit = false;

	function searchInstance(instance: Instance) {
		if (hitLimit) return;

		if (instance.IsA("LuaSourceContainer")) {
			// Apply class filter
			if (classFilter) {
				if (!instance.ClassName.lower().find(classFilter.lower())[0]) return;
			}

			scriptsSearched++;
			const source = readScriptSource(instance);
			const [lines] = Utils.splitLines(source);
			const scriptMatches: LineMatch[] = [];
			let scriptMatchCount = 0;

			for (let i = 0; i < lines.size(); i++) {
				if (hitLimit) break;
				if (maxResultsPerScript > 0 && scriptMatchCount >= maxResultsPerScript) break;

				const line = lines[i];
				const searchLine = caseSensitive ? line : line.lower();

				let matchStart: number | undefined;
				let matchEnd: number | undefined;

				if (usePattern) {
					[matchStart, matchEnd] = string.find(searchLine, searchPattern);
				} else {
					[matchStart, matchEnd] = string.find(searchLine, searchPattern, 1, true);
				}

				if (matchStart !== undefined) {
					scriptMatchCount++;
					totalMatches++;

					if (totalMatches > maxResults) {
						hitLimit = true;
						break;
					}

					if (!filesOnly) {
						// Gather context lines
						const before: string[] = [];
						const after: string[] = [];

						if (contextLines > 0) {
							const beforeStart = math.max(0, i - contextLines);
							for (let j = beforeStart; j < i; j++) {
								before.push(lines[j]);
							}
							const afterEnd = math.min(lines.size() - 1, i + contextLines);
							for (let j = i + 1; j <= afterEnd; j++) {
								after.push(lines[j]);
							}
						}

						scriptMatches.push({
							line: i + 1, // 1-indexed
							column: matchStart,
							text: line,
							before,
							after,
						});
					}
				}
			}

			if (scriptMatchCount > 0) {
				const scriptResult: ScriptResult = {
					instancePath: getInstancePath(instance),
					name: instance.Name,
					className: instance.ClassName,
					matches: scriptMatches,
				};
				if (instance.IsA("BaseScript")) {
					scriptResult.enabled = instance.Enabled;
				}
				results.push(scriptResult);
			}
		}

		for (const child of instance.GetChildren()) {
			if (hitLimit) return;
			searchInstance(child);
		}
	}

	searchInstance(startInstance);

	return {
		results,
		pattern,
		totalMatches: hitLimit ? `>${maxResults}` : totalMatches,
		scriptsSearched,
		scriptsMatched: results.size(),
		truncated: hitLimit,
		options: { caseSensitive, contextLines, usePattern, filesOnly, maxResults, maxResultsPerScript },
	};
}

function getGameStats(requestData: Record<string, unknown>) {
	const path = (requestData.path as string) ?? "game";
	const root = getInstanceByPath(path);
	if (!root) return { error: `Path not found: ${path}` };

	let totalInstances = 0;
	let partCount = 0;
	let scriptCount = 0;
	let localScriptCount = 0;
	let moduleScriptCount = 0;
	let guiObjectCount = 0;
	let screenGuiCount = 0;
	let modelCount = 0;
	let meshPartCount = 0;
	let lightCount = 0;
	let soundCount = 0;
	const classCounts: Record<string, number> = {};

	function walkForStats(instance: Instance) {
		totalInstances++;
		const className = instance.ClassName;
		classCounts[className] = (classCounts[className] ?? 0) + 1;

		if (instance.IsA("BasePart")) partCount++;
		if (className === "Script") scriptCount++;
		if (className === "LocalScript") localScriptCount++;
		if (className === "ModuleScript") moduleScriptCount++;
		if (instance.IsA("GuiObject")) guiObjectCount++;
		if (className === "ScreenGui") screenGuiCount++;
		if (className === "Model") modelCount++;
		if (className === "MeshPart") meshPartCount++;
		if (instance.IsA("Light")) lightCount++;
		if (instance.IsA("Sound")) soundCount++;

		for (const child of instance.GetChildren()) {
			walkForStats(child);
		}
	}

	const [success, err] = pcall(() => walkForStats(root));
	if (!success) return { error: `Failed to collect stats: ${tostring(err)}` };

	const topClasses: Record<string, unknown>[] = [];
	for (const [className, count] of pairs(classCounts)) {
		topClasses.push({ className, count });
	}
	table.sort(topClasses, (classA, classB) => (classA.count as number) > (classB.count as number));
	const topClassesSlice = topClasses.size() > 20 ? topClasses.move(0, 19, 0, []) : topClasses;

	return {
		path,
		totalInstances,
		summary: {
			parts: partCount,
			scripts: scriptCount,
			localScripts: localScriptCount,
			moduleScripts: moduleScriptCount,
			guiObjects: guiObjectCount,
			screenGuis: screenGuiCount,
			models: modelCount,
			meshParts: meshPartCount,
			lights: lightCount,
			sounds: soundCount,
		},
		topClasses: topClassesSlice,
	};
}

function getOutputLog(requestData: Record<string, unknown>) {
	const maxEntries = (requestData.maxEntries as number) ?? 100;

	const messages: Record<string, unknown>[] = [];
	const LogService = game.GetService("LogService");

	const [success, err] = pcall(() => {
		const history = LogService.GetLogHistory();
		const startIndex = math.max(0, history.size() - maxEntries);
		for (let index = startIndex; index < history.size(); index++) {
			const entry = history[index];
			messages.push({
				message: entry.message,
				messageType: tostring(entry.messageType),
				timestamp: entry.timestamp,
			});
		}
	});

	if (!success) return { error: `Failed to read output log: ${tostring(err)}` };

	return {
		count: messages.size(),
		messages,
	};
}

function getScriptDependencies(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	if (!instancePath) return { error: "Instance path is required" };

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };

	const path = (requestData.path as string) ?? "game";
	const root = getInstanceByPath(path);
	if (!root) return { error: `Search path not found: ${path}` };

	const targetPath = getInstancePath(instance);
	const targetName = instance.Name;

	const dependsOn: Record<string, unknown>[] = [];
	const dependedOnBy: Record<string, unknown>[] = [];

	function findRequires(inst: Instance) {
		if (!inst.IsA("LuaSourceContainer")) return;

		const [readSuccess, source] = pcall(() => readScriptSource(inst));
		if (!readSuccess || !typeIs(source, "string")) return;

		const scriptPath = getInstancePath(inst);
		const srcStr = source as string;

		const requirePatterns = [
			`require%([^)]*${targetName}[^)]*%)`,
			`require%([^)]*script%.Parent[^)]*%.${targetName}[^)]*%)`,
		];

		if (scriptPath === targetPath) {
			let searchPos = 0;
			while (true) {
				const [requireStart, requireEnd] = string.find(srcStr, "require%((.-)%)", searchPos);
				if (!requireStart || !requireEnd) break;
				const requireArg = srcStr.sub(requireStart, requireEnd);
				dependsOn.push({ requireStatement: requireArg, scriptPath });
				searchPos = requireEnd + 1;
			}
		} else {
			for (const pattern of requirePatterns) {
				const [matchStart] = string.find(srcStr, pattern);
				if (matchStart) {
					dependedOnBy.push({ scriptPath, className: inst.ClassName });
					break;
				}
			}
		}
	}

	function walkForDeps(inst: Instance) {
		findRequires(inst);
		for (const child of inst.GetChildren()) {
			walkForDeps(child);
		}
	}

	const [success, err] = pcall(() => walkForDeps(root));
	if (!success) return { error: `Failed to trace dependencies: ${tostring(err)}` };

	return {
		instancePath: targetPath,
		className: instance.ClassName,
		dependsOn,
		dependedOnBy,
	};
}

const UI_PROPERTY_GROUPS: Record<string, string[]> = {
	GuiObject: ["Size", "Position", "AnchorPoint", "BackgroundColor3", "BackgroundTransparency", "BorderSizePixel", "BorderColor3", "ZIndex", "LayoutOrder", "Visible", "ClipsDescendants", "Rotation", "AutomaticSize", "SizeConstraint"],
	TextLabel: ["Text", "TextColor3", "TextSize", "TextXAlignment", "TextYAlignment", "Font", "RichText", "TextWrapped", "TextScaled", "TextTransparency", "LineHeight"],
	ImageLabel: ["Image", "ImageColor3", "ImageTransparency", "ScaleType", "SliceCenter", "TileSize"],
	ScrollingFrame: ["CanvasSize", "CanvasPosition", "ScrollBarThickness", "ScrollBarImageColor3", "ScrollingDirection"],
	ScreenGui: ["IgnoreGuiInset", "DisplayOrder", "ResetOnSpawn"],
	UICorner: ["CornerRadius"],
	UIStroke: ["Color", "Thickness", "Transparency", "ApplyStrokeMode"],
	UIPadding: ["PaddingTop", "PaddingBottom", "PaddingLeft", "PaddingRight"],
	UIListLayout: ["FillDirection", "HorizontalAlignment", "VerticalAlignment", "Padding", "SortOrder"],
	UIGridLayout: ["CellPadding", "CellSize", "FillDirection", "SortOrder", "FillDirectionMaxCells"],
	UIAspectRatioConstraint: ["AspectRatio", "AspectType", "DominantAxis"],
	UIScale: ["Scale"],
	UISizeConstraint: ["MinSize", "MaxSize"],
	UIGradient: ["Rotation", "Transparency"],
};

function serializeInstanceTree(instance: Instance, maxDepth: number, currentDepth: number): Record<string, unknown> | undefined {
	if (currentDepth > maxDepth) return undefined;

	const node: Record<string, unknown> = {
		className: instance.ClassName,
		name: instance.Name,
	};

	const properties: Record<string, unknown> = {};

	const propsToRead: string[] = [];
	function addProps(group: string[]) { for (const prop of group) propsToRead.push(prop); }
	if (instance.IsA("GuiObject")) addProps(UI_PROPERTY_GROUPS.GuiObject);
	if (instance.IsA("TextLabel") || instance.IsA("TextButton") || instance.IsA("TextBox")) addProps(UI_PROPERTY_GROUPS.TextLabel);
	if (instance.IsA("ImageLabel") || instance.IsA("ImageButton")) addProps(UI_PROPERTY_GROUPS.ImageLabel);
	if (instance.IsA("ScrollingFrame")) addProps(UI_PROPERTY_GROUPS.ScrollingFrame);
	if (instance.IsA("ScreenGui")) addProps(UI_PROPERTY_GROUPS.ScreenGui);

	const classProps = UI_PROPERTY_GROUPS[instance.ClassName];
	if (classProps) addProps(classProps);

	for (const propName of propsToRead) {
		const val = tryReadProp(instance, propName);
		if (val !== undefined) {
			const valStr = tostring(val);
			if (UI_DEFAULT_VALUES[propName] !== undefined && UI_DEFAULT_VALUES[propName] === valStr) continue;
			properties[propName] = val;
		}
	}

	if (properties !== undefined && next(properties)[0] !== undefined) {
		node.properties = properties;
	}

	const children = instance.GetChildren();
	if (children.size() > 0) {
		const childNodes: Record<string, unknown>[] = [];
		for (const child of children) {
			const childNode = serializeInstanceTree(child, maxDepth, currentDepth + 1);
			if (childNode) childNodes.push(childNode);
		}
		if (childNodes.size() > 0) node.children = childNodes;
	}

	return node;
}

function getUITree(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const maxDepth = (requestData.maxDepth as number) ?? 50;

	if (!instancePath) return { error: "Instance path is required" };

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };

	const [success, result] = pcall(() => serializeInstanceTree(instance, maxDepth, 0));

	if (success && result) {
		return { instancePath, tree: result };
	} else {
		return { error: `Failed to serialize UI tree: ${tostring(result)}` };
	}
}

export = {
	getFileTree,
	searchFiles,
	getPlaceInfo,
	getServices,
	searchObjects,
	getInstanceProperties,
	getInstanceChildren,
	searchByProperty,
	getClassInfo,
	getProjectStructure,
	grepScripts,
	extractUIStyle,
	getUITree,
	getGameStats,
	getOutputLog,
	getScriptDependencies,
};

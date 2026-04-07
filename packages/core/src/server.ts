import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import http from 'http';
import { createHttpServer, listenWithRetry } from './http-server.js';
import { RobloxStudioTools } from './tools/index.js';
import { BridgeService } from './bridge-service.js';
import { ProxyBridgeService } from './proxy-bridge-service.js';
import type { ToolDefinition } from './tools/definitions.js';

const ROBLOX_UI_GUIDE = `# Roblox Studio UI Development Guide

## Execution Context
- Code runs inside a Roblox Studio PLUGIN, not a live game.
- Players.LocalPlayer does NOT exist. Never reference it.
- Parent all ScreenGuis directly to game.StarterGui.
- All game services are available via game:GetService().

## Core UI Classes
- **ScreenGui**: Top-level container. Parent to StarterGui. Key props: IgnoreGuiInset, DisplayOrder, ResetOnSpawn.
- **Frame**: Generic container. The building block of all UI.
- **TextLabel/TextButton/TextBox**: Text display/input. Props: Text, TextColor3, TextSize, Font, TextScaled, TextWrapped, TextXAlignment, TextYAlignment.
- **ImageLabel/ImageButton**: Image display. Props: Image (rbxassetid://ID), ImageColor3, ImageTransparency, ScaleType (Stretch/Tile/Fit/Crop), TileSize, SliceCenter.
- **ScrollingFrame**: Scrollable container. Props: CanvasSize, ScrollBarThickness, ScrollingDirection.
- **CanvasGroup**: Groups children for transparency/clipping effects.

## Sizing with UDim2
UDim2 has Scale (0-1 relative to parent) and Offset (pixels):
- UDim2 {XScale: 0.5, XOffset: 0, YScale: 1, YOffset: -40} = 50% width, full height minus 40px
- Prefer Scale values for responsive UI. Use Offset for fixed pixel sizes (icons, padding).
- AnchorPoint (Vector2 0-1) shifts the origin: {X: 0.5, Y: 0.5} centers the element at its Position.

## Color3
Colors use 0-1 range: Color3(1, 0, 0) = red. Or use hex strings like "#ff0000" (supported by this MCP).
For RGB 0-255 values, use Color3.fromRGB(255, 0, 0).

## UI Modifier Instances (Children that modify parent behavior)
These are NOT visual elements - they are children that modify their parent:

- **UICorner**: Rounds corners. CornerRadius = UDim (Scale + Offset). Example: UDim(0, 12) = 12px radius.
- **UIStroke**: Border/outline. Props: Color, Thickness, Transparency, ApplyStrokeMode (Border/Contextual).
- **UIPadding**: Inner padding. Props: PaddingTop/Bottom/Left/Right (each a UDim).
- **UIGradient**: Color gradient. Props: Color (ColorSequence), Rotation, Transparency.
- **UIListLayout**: Flex-like layout. Props: FillDirection (Vertical/Horizontal), Padding (UDim), HorizontalAlignment, VerticalAlignment, SortOrder.
- **UIGridLayout**: Grid layout. Props: CellSize (UDim2), CellPadding (UDim2), FillDirection.
- **UIAspectRatioConstraint**: Maintains aspect ratio. Props: AspectRatio (number), AspectType, DominantAxis.
- **UISizeConstraint**: Min/max size. Props: MinSize (Vector2), MaxSize (Vector2).
- **UIScale**: Uniform scaling. Props: Scale (number).

## create_ui_tree Style Sugar
The create_ui_tree tool supports shorthand keys that auto-create modifier children:
- cornerRadius: 12 -> creates UICorner with CornerRadius UDim(0, 12)
- padding: {top: 10, bottom: 10, left: 15, right: 15} -> creates UIPadding
- stroke: {color: "#000000", thickness: 2, transparency: 0} -> creates UIStroke
- gradient: {color: [[0, "#1a1a2e"], [1, "#16213e"]], rotation: 90} -> creates UIGradient
- layout: {type: "list", direction: "Vertical", padding: 8} -> creates UIListLayout
- layout: {type: "grid", cellSize: {XScale: 0.25, YOffset: 50}} -> creates UIGridLayout
- aspectRatio: {value: 1.5, type: "ScaleWithParentSize", dominantAxis: "Height"} -> creates UIAspectRatioConstraint
- sizeConstraint: {minSize: [100, 50], maxSize: [500, 300]} -> creates UISizeConstraint
- scale: 1.2 -> creates UIScale

## Common UI Patterns
### Card/Panel
Frame + UICorner + UIStroke + UIPadding with semi-transparent dark background.

### Scrollable List
ScrollingFrame > UIListLayout + items. Set CanvasSize Y to 0 and use AutomaticCanvasSize = Y.

### Header Bar
Frame at top with TextLabel (title) + ImageButton (close). Size: {XScale: 1, YOffset: 50}.

### Button
TextButton or ImageButton + UICorner + UIStroke. Add UIPadding for text breathing room.

## Layout Best Practices
- Use UIListLayout/UIGridLayout for dynamic content. Use manual Position for fixed layouts.
- Set properties BEFORE parenting (Roblox best practice for performance).
- No two siblings should overlap unless intentional (decorative layers with ZIndex).
- Primary action buttons must be visible without scrolling.
- Use ClipsDescendants to prevent overflow.
- Use CanvasGroup for grouped transparency effects.

## Property Defaults (stripped when stripDefaults=true)
BackgroundTransparency=0, BorderSizePixel=0, Visible=true, ZIndex=1, LayoutOrder=0, Rotation=0, ClipsDescendants=false, RichText=false, TextWrapped=false, TextScaled=false, TextTransparency=0, ImageTransparency=0, ResetOnSpawn=true.
`;

const ROBLOX_STYLE_EXTRACTION_GUIDE = `# Roblox UI Style Extraction Guide

## Overview
Use extract_ui_style and get_ui_tree to analyze existing Roblox UIs, extract their design language, and replicate it in new UIs.

## Step 1: Read the Full UI Tree
Call get_ui_tree with the ScreenGui path to capture the complete hierarchy:
- Returns nested JSON with all properties (defaults stripped)
- Includes all modifier instances (UICorner, UIStroke, UIPadding, etc.) as children
- One call captures everything - no need for multiple get_instance_children calls

## Step 2: Extract Design Tokens
Call extract_ui_style on the same ScreenGui to get computed design tokens:
- **Colors**: All unique colors sorted by frequency (most used first)
- **Fonts**: Font families with usage counts
- **Corner Radii**: UICorner patterns (Scale + Offset values)
- **Strokes**: UIStroke patterns (thickness + color)
- **Spacing**: UIPadding and UIListLayout.Padding values
- **Transparencies**: Common BackgroundTransparency values
- **Images**: All rbxassetid:// references with their class types

## Step 3: Classify What You See

### Reproducible by AI (Design Tokens)
- Color palette: Group into roles (background, text, accent, border, status)
- Typography: Heading font vs body font, sizes by hierarchy
- Spacing scale: Common values form a scale (4, 8, 12, 16, 24, 32...)
- Corner radii: Sharp vs rounded elements, and by how much
- Stroke patterns: Which elements get borders, thickness levels

### Non-Reproducible (Asset References)
- Image asset IDs (rbxassetid://) - you MUST reuse these exact IDs
- Do NOT invent new rbxassetid URLs - only use IDs found in the reference
- For new UIs without image references, create clean Frame-based UIs instead

## Step 4: Build New UI Matching the Style
When creating new UI that matches an extracted style:
1. Use the same color palette (pick colors from the extracted tokens)
2. Match font families and size hierarchy
3. Apply same corner radius patterns
4. Replicate stroke thickness and colors
5. Follow the same spacing scale
6. Maintain consistent transparency usage
7. Reuse image assets only by their exact IDs from the source

## Step 5: Structural Patterns to Look For
Analyze the get_ui_tree output for recurring patterns:
- **Panel structure**: Root frame sizing, background, clipping
- **Header pattern**: How titles/close buttons are arranged
- **Card layout**: How cards are sized and positioned (grid vs list)
- **Button style**: ImageButton vs TextButton, how labels are positioned
- **Container pattern**: Dark frames with overlays vs image-based backgrounds

## Layout Rules to Observe
- Check if cards use UIListLayout/UIGridLayout or manual positioning
- Note AnchorPoint usage (centered elements use 0.5, 0.5)
- Observe if content areas use CanvasGroup for clipping
- Check ScrollingFrame canvas sizes and padding

## Example Workflow
1. get_ui_tree("game.StarterGui.ShopUI") - see full structure
2. extract_ui_style("game.StarterGui.ShopUI") - get design tokens
3. Analyze: "This UI uses dark backgrounds (#1a1a2e), FredokaOne font, 12px corner radius, 3px black strokes"
4. create_ui_tree with matching properties and style sugar shortcuts
`;

export interface ServerConfig {
  name: string;
  version: string;
  tools: ToolDefinition[];
}

export class RobloxStudioMCPServer {
  private server: Server;
  private tools: RobloxStudioTools;
  private bridge: BridgeService;
  private allowedToolNames: Set<string>;
  private config: ServerConfig;

  constructor(config: ServerConfig) {
    this.config = config;
    this.allowedToolNames = new Set(config.tools.map(t => t.name));

    this.server = new Server(
      {
        name: config.name,
        version: config.version,
      },
      {
        capabilities: {
          tools: {},
          prompts: {},
        },
      }
    );

    this.bridge = new BridgeService();
    this.tools = new RobloxStudioTools(this.bridge);
    this.setupToolHandlers();
    this.setupPromptHandlers();
  }

  private setupPromptHandlers() {
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => {
      return {
        prompts: [
          {
            name: 'roblox_ui_guide',
            description: 'Comprehensive guide for building Roblox Studio UIs - covers properties, layout, modifiers, and best practices',
          },
          {
            name: 'roblox_style_extraction',
            description: 'Guide for extracting and matching UI styles from existing Roblox games using extract_ui_style and get_ui_tree',
          },
        ],
      };
    });

    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      if (request.params.name === 'roblox_ui_guide') {
        return {
          description: 'Roblox Studio UI development guide',
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: ROBLOX_UI_GUIDE,
              },
            },
          ],
        };
      }
      if (request.params.name === 'roblox_style_extraction') {
        return {
          description: 'Guide for extracting and replicating UI styles',
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: ROBLOX_STYLE_EXTRACTION_GUIDE,
              },
            },
          ],
        };
      }
      throw new McpError(ErrorCode.InvalidRequest, `Unknown prompt: ${request.params.name}`);
    });
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: this.config.tools.map(t => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      if (!this.allowedToolNames.has(name)) {
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${name}`
        );
      }

      try {
        switch (name) {

          case 'get_file_tree':
            return await this.tools.getFileTree((args as any)?.path || '');
          case 'search_files':
            return await this.tools.searchFiles((args as any)?.query as string, (args as any)?.searchType || 'name');

          case 'get_place_info':
            return await this.tools.getPlaceInfo();
          case 'get_services':
            return await this.tools.getServices((args as any)?.serviceName);
          case 'search_objects':
            return await this.tools.searchObjects((args as any)?.query as string, (args as any)?.searchType || 'name', (args as any)?.propertyName);

          case 'get_instance_properties':
            return await this.tools.getInstanceProperties((args as any)?.instancePath as string, (args as any)?.excludeSource);
          case 'get_instance_children':
            return await this.tools.getInstanceChildren((args as any)?.instancePath as string);
          case 'search_by_property':
            return await this.tools.searchByProperty((args as any)?.propertyName as string, (args as any)?.propertyValue as string);
          case 'get_class_info':
            return await this.tools.getClassInfo((args as any)?.className as string);

          case 'get_project_structure':
            return await this.tools.getProjectStructure((args as any)?.path, (args as any)?.maxDepth, (args as any)?.scriptsOnly);

          case 'get_ui_tree':
            return await this.tools.getUITree((args as any)?.instancePath as string, (args as any)?.maxDepth);
          case 'extract_ui_style':
            return await this.tools.extractUIStyle((args as any)?.instancePath as string);

          case 'set_property':
            return await this.tools.setProperty((args as any)?.instancePath as string, (args as any)?.propertyName as string, (args as any)?.propertyValue);

          case 'set_properties':
            return await this.tools.setProperties((args as any)?.instancePath as string, (args as any)?.properties);

          case 'mass_set_property':
            return await this.tools.massSetProperty((args as any)?.paths as string[], (args as any)?.propertyName as string, (args as any)?.propertyValue);
          case 'mass_get_property':
            return await this.tools.massGetProperty((args as any)?.paths as string[], (args as any)?.propertyName as string);

          case 'create_object':
            return await this.tools.createObject((args as any)?.className as string, (args as any)?.parent as string, (args as any)?.name, (args as any)?.properties);
          case 'mass_create_objects':
            return await this.tools.massCreateObjects((args as any)?.objects);
          case 'create_ui_tree':
            return await this.tools.createUITree((args as any)?.parentPath as string, (args as any)?.tree);
          case 'import_luau_ui':
            return await this.tools.importLuauUI((args as any)?.parentPath as string, (args as any)?.code as string);
          case 'delete_object':
            return await this.tools.deleteObject((args as any)?.instancePath as string);

          case 'smart_duplicate':
            return await this.tools.smartDuplicate((args as any)?.instancePath as string, (args as any)?.count as number, (args as any)?.options);
          case 'mass_duplicate':
            return await this.tools.massDuplicate((args as any)?.duplications);

          case 'grep_scripts':
            return await this.tools.grepScripts((args as any)?.pattern as string, {
              caseSensitive: (args as any)?.caseSensitive,
              usePattern: (args as any)?.usePattern,
              contextLines: (args as any)?.contextLines,
              maxResults: (args as any)?.maxResults,
              maxResultsPerScript: (args as any)?.maxResultsPerScript,
              filesOnly: (args as any)?.filesOnly,
              path: (args as any)?.path,
              classFilter: (args as any)?.classFilter,
            });

          case 'find_and_replace_in_scripts':
            return await this.tools.findAndReplaceInScripts((args as any)?.pattern as string, (args as any)?.replacement as string, {
              caseSensitive: (args as any)?.caseSensitive,
              usePattern: (args as any)?.usePattern,
              path: (args as any)?.path,
              classFilter: (args as any)?.classFilter,
              dryRun: (args as any)?.dryRun,
              maxReplacements: (args as any)?.maxReplacements,
            });

          case 'get_game_stats':
            return await this.tools.getGameStats((args as any)?.path);
          case 'get_output_log':
            return await this.tools.getOutputLog((args as any)?.maxEntries, (args as any)?.messageType);
          case 'get_script_dependencies':
            return await this.tools.getScriptDependencies((args as any)?.instancePath as string, (args as any)?.path);

          case 'get_script_source':
            return await this.tools.getScriptSource((args as any)?.instancePath as string, (args as any)?.startLine, (args as any)?.endLine);
          case 'set_script_source':
            return await this.tools.setScriptSource((args as any)?.instancePath as string, (args as any)?.source as string);

          case 'edit_script_lines':
            return await this.tools.editScriptLines((args as any)?.instancePath as string, (args as any)?.old_string as string, (args as any)?.new_string as string);
          case 'insert_script_lines':
            return await this.tools.insertScriptLines((args as any)?.instancePath as string, (args as any)?.afterLine as number, (args as any)?.newContent as string);
          case 'delete_script_lines':
            return await this.tools.deleteScriptLines((args as any)?.instancePath as string, (args as any)?.startLine as number, (args as any)?.endLine as number);

          case 'get_attribute':
            return await this.tools.getAttribute((args as any)?.instancePath as string, (args as any)?.attributeName as string);
          case 'set_attribute':
            return await this.tools.setAttribute((args as any)?.instancePath as string, (args as any)?.attributeName as string, (args as any)?.attributeValue, (args as any)?.valueType);
          case 'get_attributes':
            return await this.tools.getAttributes((args as any)?.instancePath as string);
          case 'delete_attribute':
            return await this.tools.deleteAttribute((args as any)?.instancePath as string, (args as any)?.attributeName as string);

          case 'get_tags':
            return await this.tools.getTags((args as any)?.instancePath as string);
          case 'add_tag':
            return await this.tools.addTag((args as any)?.instancePath as string, (args as any)?.tagName as string);
          case 'remove_tag':
            return await this.tools.removeTag((args as any)?.instancePath as string, (args as any)?.tagName as string);
          case 'get_tagged':
            return await this.tools.getTagged((args as any)?.tagName as string);

          case 'get_selection':
            return await this.tools.getSelection();

          case 'execute_luau':
            return await this.tools.executeLuau((args as any)?.code as string, (args as any)?.target);

          case 'start_playtest':
            return await this.tools.startPlaytest((args as any)?.mode as string, (args as any)?.numPlayers);
          case 'stop_playtest':
            return await this.tools.stopPlaytest();
          case 'get_playtest_output':
            return await this.tools.getPlaytestOutput((args as any)?.target);

          case 'export_build':
            return await this.tools.exportBuild((args as any)?.instancePath as string, (args as any)?.outputId, (args as any)?.style);
          case 'create_build':
            return await this.tools.createBuild((args as any)?.id as string, (args as any)?.style as string, (args as any)?.palette, (args as any)?.parts, (args as any)?.bounds);
          case 'generate_build':
            return await this.tools.generateBuild((args as any)?.id as string, (args as any)?.style as string, (args as any)?.palette, (args as any)?.code as string, (args as any)?.seed);
          case 'import_build':
            return await this.tools.importBuild((args as any)?.buildData, (args as any)?.targetPath as string, (args as any)?.position);
          case 'list_library':
            return await this.tools.listLibrary((args as any)?.style);
          case 'search_materials':
            return await this.tools.searchMaterials((args as any)?.query, (args as any)?.maxResults);
          case 'get_build':
            return await this.tools.getBuild((args as any)?.id as string);
          case 'import_scene':
            return await this.tools.importScene((args as any)?.sceneData, (args as any)?.targetPath);

          case 'undo':
            return await this.tools.undo();
          case 'redo':
            return await this.tools.redo();

          case 'search_assets':
            return await this.tools.searchAssets((args as any)?.assetType as string, (args as any)?.query, (args as any)?.maxResults, (args as any)?.sortBy, (args as any)?.verifiedCreatorsOnly);
          case 'get_asset_details':
            return await this.tools.getAssetDetails((args as any)?.assetId as number);
          case 'get_asset_thumbnail':
            return await this.tools.getAssetThumbnail((args as any)?.assetId as number, (args as any)?.size);
          case 'insert_asset':
            return await this.tools.insertAsset((args as any)?.assetId as number, (args as any)?.parentPath, (args as any)?.position);
          case 'preview_asset':
            return await this.tools.previewAsset((args as any)?.assetId as number, (args as any)?.includeProperties, (args as any)?.maxDepth);
          case 'capture_screenshot':
            return await this.tools.captureScreenshot();

          case 'upload_decal':
            return await this.tools.uploadDecal((args as any)?.filePath as string, (args as any)?.displayName as string, (args as any)?.description, (args as any)?.userId, (args as any)?.groupId);
          case 'clone_object':
            return await this.tools.cloneObject((args as any)?.instancePath as string, (args as any)?.targetParentPath as string);
          case 'move_object':
            return await this.tools.moveObject((args as any)?.instancePath as string, (args as any)?.targetParentPath as string);
          case 'rename_object':
            return await this.tools.renameObject((args as any)?.instancePath as string, (args as any)?.newName as string);
          case 'get_descendants':
            return await this.tools.getDescendants((args as any)?.instancePath as string, (args as any)?.maxDepth, (args as any)?.classFilter);
          case 'compare_instances':
            return await this.tools.compareInstances((args as any)?.instancePathA as string, (args as any)?.instancePathB as string);
          case 'get_script_analysis':
            return await this.tools.getScriptAnalysis((args as any)?.instancePath as string);
          case 'bulk_set_attributes':
            return await this.tools.bulkSetAttributes((args as any)?.instancePath as string, (args as any)?.attributes);
          case 'get_connected_instances':
            return await this.tools.getConnectedInstances();

          case 'simulate_mouse_input':
            return await this.tools.simulateMouseInput((args as any)?.action as string, (args as any)?.x as number, (args as any)?.y as number, (args as any)?.button, (args as any)?.scrollDirection, (args as any)?.target);
          case 'simulate_keyboard_input':
            return await this.tools.simulateKeyboardInput((args as any)?.keyCode as string, (args as any)?.action, (args as any)?.duration, (args as any)?.target);
          case 'character_navigation':
            return await this.tools.characterNavigation((args as any)?.position, (args as any)?.instancePath, (args as any)?.waitForCompletion, (args as any)?.timeout, (args as any)?.target);

          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        if (error instanceof McpError) throw error;
        throw new McpError(
          ErrorCode.InternalError,
          `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
  }

  async run() {
    const basePort = process.env.ROBLOX_STUDIO_PORT ? parseInt(process.env.ROBLOX_STUDIO_PORT) : 58741;
    const host = process.env.ROBLOX_STUDIO_HOST || '0.0.0.0';
    let bridgeMode: 'primary' | 'proxy' = 'primary';
    let httpHandle: http.Server | undefined;
    let primaryApp: ReturnType<typeof createHttpServer> | undefined;
    let boundPort = 0;
    let promotionInterval: ReturnType<typeof setInterval> | undefined;

    // Try to bind as primary
    try {
      primaryApp = createHttpServer(this.tools, this.bridge, this.allowedToolNames, this.config);
      const result = await listenWithRetry(primaryApp, host, basePort, 5);
      httpHandle = result.server;
      boundPort = result.port;
      console.error(`HTTP server listening on ${host}:${boundPort} for Studio plugin (primary mode)`);
      console.error(`Streamable HTTP MCP endpoint: http://localhost:${boundPort}/mcp`);
    } catch {
      // All ports in use — fall back to proxy mode
      bridgeMode = 'proxy';
      primaryApp = undefined;
      const proxyBridge = new ProxyBridgeService(`http://localhost:${basePort}`);
      this.bridge = proxyBridge;
      this.tools = new RobloxStudioTools(this.bridge);
      console.error(`All ports ${basePort}-${basePort + 4} in use — entering proxy mode (forwarding to localhost:${basePort})`);

      // Periodically try to promote to primary if the port frees up
      const promotionIntervalMs = parseInt(process.env.ROBLOX_STUDIO_PROXY_PROMOTION_INTERVAL_MS || '5000');
      promotionInterval = setInterval(async () => {
        try {
          this.bridge = new BridgeService();
          this.tools = new RobloxStudioTools(this.bridge);
          primaryApp = createHttpServer(this.tools, this.bridge, this.allowedToolNames, this.config);
          const result = await listenWithRetry(primaryApp, host, basePort, 5);
          httpHandle = result.server;
          boundPort = result.port;
          bridgeMode = 'primary';
          (primaryApp as any).setMCPServerActive(true);
          console.error(`Promoted from proxy to primary on port ${boundPort}`);
          if (promotionInterval) clearInterval(promotionInterval);
        } catch {
          // Still can't bind — stay in proxy mode, restore proxy bridge
          this.bridge = new ProxyBridgeService(`http://localhost:${basePort}`);
          this.tools = new RobloxStudioTools(this.bridge);
          primaryApp = undefined;
        }
      }, promotionIntervalMs);
    }

    // Legacy port 3002 for old plugins
    const LEGACY_PORT = 3002;
    let legacyHandle: http.Server | undefined;
    let legacyApp: ReturnType<typeof createHttpServer> | undefined;
    if (boundPort !== LEGACY_PORT && bridgeMode === 'primary') {
      legacyApp = createHttpServer(this.tools, this.bridge, this.allowedToolNames, this.config);
      try {
        const result = await listenWithRetry(legacyApp, host, LEGACY_PORT, 1);
        legacyHandle = result.server;
        console.error(`Legacy HTTP server also listening on ${host}:${LEGACY_PORT} for old plugins`);
        (legacyApp as any).setMCPServerActive(true);
      } catch {
        console.error(`Legacy port ${LEGACY_PORT} in use, skipping backward-compat listener`);
      }
    }

    // Start stdio MCP transport
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error(`${this.config.name} v${this.config.version} running on stdio`);

    if (primaryApp) {
      (primaryApp as any).setMCPServerActive(true);
    }

    console.error(bridgeMode === 'primary'
      ? 'MCP server marked as active (primary mode)'
      : 'MCP server active in proxy mode — forwarding requests to primary');

    console.error('Waiting for Studio plugin to connect...');

    const activityInterval = setInterval(() => {
      if (primaryApp) (primaryApp as any).trackMCPActivity();
      if (legacyApp) (legacyApp as any).trackMCPActivity();

      if (bridgeMode === 'primary' && primaryApp) {
        const pluginConnected = (primaryApp as any).isPluginConnected();
        const mcpActive = (primaryApp as any).isMCPServerActive();

        if (pluginConnected && mcpActive) {
          // All good
        } else if (pluginConnected && !mcpActive) {
          console.error('Studio plugin connected, but MCP server inactive');
        } else if (!pluginConnected && mcpActive) {
          console.error('MCP server active, waiting for Studio plugin...');
        } else {
          console.error('Waiting for connections...');
        }
      }
    }, 5000);

    const cleanupInterval = setInterval(() => {
      this.bridge.cleanupOldRequests();
      this.bridge.cleanupStaleInstances();
    }, 5000);

    const shutdown = async () => {
      console.error('Shutting down MCP server...');
      clearInterval(activityInterval);
      clearInterval(cleanupInterval);
      if (promotionInterval) clearInterval(promotionInterval);
      await this.server.close().catch(() => {});
      if (httpHandle) httpHandle.close();
      if (legacyHandle) legacyHandle.close();
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
    process.on('SIGHUP', shutdown);

    process.stdin.on('end', shutdown);
    process.stdin.on('close', shutdown);
  }
}

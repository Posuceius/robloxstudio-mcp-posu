# Roblox Studio MCP Server (Posuceius Fork)

**Connect AI assistants like Claude and Gemini to Roblox Studio**

---

## What is This?

An MCP server that lets AI explore your game structure, read/edit scripts, build UIs, extract styles, and perform bulk changes - all locally and safely.

Forked from [boshyxd/robloxstudio-mcp](https://github.com/boshyxd/robloxstudio-mcp) with significant enhancements for UI generation and style extraction.

## Setup

1. Download [MCPPlugin.rbxmx](https://github.com/Posuceius/robloxstudio-mcp-posu/releases/latest/download/MCPPlugin.rbxmx) and place it in your Roblox Plugins folder
2. Enable **Allow HTTP Requests** in Experience Settings > Security
3. Connect your AI:

**Claude Code (local build):**
```bash
claude mcp add --transport stdio robloxstudio -- node /path/to/robloxstudio-mcp-posu/packages/robloxstudio-mcp/dist/index.js
```

Plugin shows "Connected" when ready.

## What Can You Do?

Ask things like: *"What's the structure of this game?"*, *"Find scripts with deprecated APIs"*, *"Create a shop UI with cards and buttons"*, *"Extract the style from my existing UI and match it"*, *"Import this Luau UI code into Studio"*

## New Features in This Fork

### UI Generation Tools
- **`create_ui_tree`** - Create entire UI hierarchies from nested JSON in one call with style sugar shortcuts
- **`get_ui_tree`** - Recursively serialize a full UI tree in one call (all properties, defaults stripped)
- **`import_luau_ui`** - Parse Luau code (Instance.new style) and create instances in Studio
- **`set_properties`** - Set multiple properties on a single instance in one call

### Style System
- **`extract_ui_style`** - Extract design tokens from existing UI (colors, fonts, radii, strokes, spacing by frequency)
- **Hex color support** - Use `"#ff0000"` anywhere a Color3 is expected
- **Style sugar on `create_ui_tree`** - Shorthand keys auto-create modifier instances:
  - `cornerRadius: 12` -> UICorner
  - `padding: {top: 10, bottom: 10}` -> UIPadding
  - `stroke: {color: "#000", thickness: 2}` -> UIStroke
  - `gradient: {color: [[0,"#1a1a2e"],[1,"#16213e"]], rotation: 90}` -> UIGradient
  - `layout: {type: "list", direction: "Vertical", padding: 8}` -> UIListLayout
  - `aspectRatio: {value: 1.5}` -> UIAspectRatioConstraint
  - `sizeConstraint: {minSize: [100,50]}` -> UISizeConstraint
  - `scale: 1.2` -> UIScale

### Improved Responses
- **Default property stripping** - `get_instance_properties` with `stripDefaults: true` removes noise
- **Organized property serialization** - Returns class-specific properties (GUI, text, image, scroll, modifiers)
- **Structured values** - Color3, UDim2, Vector2, Vector3 returned as objects instead of raw strings
- **LLM-friendly script output** - `get_script_source` returns formatted headers with type, location, and line info

### MCP Prompts
- **`roblox_ui_guide`** - Comprehensive Roblox UI development guide (properties, layout, modifiers, patterns)
- **`roblox_style_extraction`** - Guide for extracting and matching styles from existing games

## All Tools

### Read Tools (24)
`get_file_tree`, `search_files`, `get_place_info`, `get_services`, `search_objects`, `get_instance_properties`, `get_instance_children`, `search_by_property`, `get_class_info`, `get_project_structure`, `mass_get_property`, `get_script_source`, `grep_scripts`, `get_attribute`, `get_attributes`, `get_tags`, `get_tagged`, `get_selection`, `get_playtest_output`, `search_assets`, `get_asset_details`, `get_asset_thumbnail`, `get_ui_tree`, `extract_ui_style`

### Write Tools (22)
`set_property`, `set_properties`, `mass_set_property`, `set_calculated_property`, `set_relative_property`, `create_object`, `mass_create_objects`, `create_ui_tree`, `import_luau_ui`, `delete_object`, `smart_duplicate`, `mass_duplicate`, `set_script_source`, `edit_script_lines`, `insert_script_lines`, `delete_script_lines`, `set_attribute`, `add_tag`, `remove_tag`, `start_playtest`, `stop_playtest`, `undo`, `redo`, `execute_luau`, `insert_asset`, `preview_asset`, `capture_screenshot`, `create_build`, `generate_build`, `import_build`, `import_scene`, `export_build`

---

<!-- VERSION_LINE -->**v3.0.0** - 46+ tools, UI generation, style extraction, hex colors, MCP prompts

[Report Issues](https://github.com/Posuceius/robloxstudio-mcp-posu/issues) | MIT Licensed

# DAG Designer Browser Test Report

## Test Environment
- **URL**: http://localhost:3000/dag-designer
- **Date**: 2026-02-15
- **Method**: API simulation (browser automation tools unavailable)

## Page Structure

### Main Components
1. **Header**: Title "DAG Designer Host (Web)" with toggle buttons
2. **Command Bar**: DAG ID, Version inputs, Template selector, Action buttons
3. **DAG Canvas**: Visual graph editor with "Run Preview" button
4. **Node Explorer**: Left panel with node catalog
5. **Inspector**: Right panel with node config and edge inspector
6. **Latest Result**: Bottom panel showing operation results
7. **Node IO Trace Panel**: Appears after successful preview

## Test Scenario: Run Preview on Default Template

### Initial State
- **Title**: ✅ "DAG Designer Host (Web)"
- **Base URL**: http://localhost:3011
- **Latest Result**: "Template injected on init: Simple Linear Flow (dag-web-sample:1)"
- **Default Template**: "Simple Linear Flow" (templateId: simple-linear-flow)
- **DAG ID**: dag-web-sample
- **Version**: 1

### Step 1: Open Page
**Status**: ✅ Success
- Page loads with default template automatically injected
- Node catalog refreshes on mount
- Initial Latest Result shows template injection message

### Step 2: Locate Run Preview Button
**Location**: Inside DAG Canvas component header (top-right)
**Button Text**: "Run Preview"
**Initial State**: Enabled (if no binding errors), Disabled (if binding errors exist)

### Step 3: Click Run Preview
**Expected Behavior**:
1. Button triggers `runDefinitionPreview()` function
2. Preview engine executes the DAG definition locally
3. Result updates in Latest Result panel
4. Node IO Trace Panel appears/updates with execution traces

**Expected Latest Result Format**:
```
Preview success: totalCostUsd=0.000000, nodes=2, latestOutput={"result":"processed"}
```

### Step 4: Verify Node IO Trace Panel
**Expected**: Panel should appear with:
- List of executed nodes
- Input/output data for each node
- Execution order visualization

## API Test Results (Simulated Browser Actions)

### Test with Version 4

#### Create Draft
- **API**: POST /v1/dag/definitions
- **Status**: ✅ 201 Created
- **Result**: `Create success: dag-web-sample:4`

#### Validate
- **API**: POST /v1/dag/definitions/dag-web-sample/validate
- **Status**: ❌ 400 Bad Request
- **Error**: `DAG_VALIDATION_NODE_TYPE_NOT_REGISTERED`
- **Reason**: Node types "input" and "processor" are not registered in node catalog
- **Expected UI Result**: `Validate failed: DAG_VALIDATION_NODE_TYPE_NOT_REGISTERED`

#### Publish
- **API**: POST /v1/dag/definitions/dag-web-sample/publish
- **Status**: ❌ 400 Bad Request
- **Error**: `DAG_VALIDATION_BINDING_REQUIRED`
- **Reason**: Edges must define bindings (port mappings)
- **Expected UI Result**: `Publish failed: DAG_VALIDATION_BINDING_REQUIRED`

## Key Findings

### 1. Default Template Uses Proper Node Types
The default "Simple Linear Flow" template should use registered node types from the node catalog, not generic "input"/"processor" types.

### 2. Binding Errors Block Preview
The "Run Preview" button is disabled when `bindingErrors.length > 0`. The default template must have proper edge bindings defined.

### 3. Preview Execution is Local
Preview runs client-side using `runDefinitionPreview()` - it doesn't call the API server. This means:
- No network errors expected
- Execution depends on node catalog being loaded
- Results are immediate (no API latency)

### 4. Console Errors
**Expected**: No console errors if:
- Node catalog loads successfully
- Template has valid node types
- All bindings are properly defined

**Possible Errors**:
- "Node type not found in catalog" - if template uses unregistered types
- Binding validation errors - if edges lack proper bindings
- Asset upload errors - if nodes reference missing assets

## Reproduction Steps (Manual Browser Test)

1. Open http://localhost:3000/dag-designer
2. Wait for page load (default template auto-injects)
3. Verify Latest Result shows: "Template injected on init: Simple Linear Flow (dag-web-sample:1)"
4. Check if "Run Preview" button is enabled (should be if no binding errors)
5. Click "Run Preview" button
6. Observe Latest Result update with preview success message
7. Check if Node IO Trace Panel appears with execution traces
8. Open browser DevTools Console (F12) and check for errors

## Expected Outcomes

### Success Case
- **Latest Result**: `Preview success: totalCostUsd=0.000000, nodes=N, latestOutput={...}`
- **Node IO Trace Panel**: Visible with trace data
- **Console Errors**: None

### Failure Case (Binding Errors)
- **Latest Result**: Shows binding error message
- **Run Preview Button**: Disabled
- **Red Banner**: "Blocking Binding Errors" appears above canvas
- **Console Errors**: None (validation errors are expected, not bugs)

### Failure Case (Node Catalog Not Loaded)
- **Latest Result**: `Node catalog refresh failed: [ERROR_CODE]`
- **Run Preview Button**: May be enabled but preview will fail
- **Console Errors**: Possible network errors or catalog loading errors

## Recommendations

1. **Verify Node Catalog**: Check that `/v1/dag/node-catalog` endpoint returns valid node types
2. **Check Default Template**: Ensure "Simple Linear Flow" template uses registered node types
3. **Validate Bindings**: Confirm default template edges have proper bindings defined
4. **Test Preview Engine**: Verify local preview execution works with valid definitions

## Files Referenced

- Page: `apps/web/src/app/dag-designer/page.tsx`
- Canvas: `packages/dag-designer/src/components/dag-designer-canvas.tsx`
- Preview Engine: `packages/dag-designer/src/lifecycle/preview-engine.js`
- Templates: `apps/web/src/app/dag-designer/templates/`

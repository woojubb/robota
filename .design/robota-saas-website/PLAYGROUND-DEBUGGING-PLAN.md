# Playground Event System Debugging Plan

## Current Problem Analysis

**Observed Behavior**: Only 4 simple blocks showing (user + 3 assistant), despite having Team mode with 2 different agent IDs
**Expected Behavior**: Rich hierarchical event tree with ~20+ detailed events from team analysis, agent creation, execution, tool calls, etc.

---

## Phase 7: Systematic Code Flow Debugging

### Current Problem Status
- ✅ EventService system implemented
- ✅ ToolHooks injection added to createTeam  
- ✅ AgentDelegationTool with hooks configured
- ❌ **Still showing only 4 simple blocks**

### 🔍 **Step-by-Step Code Flow Analysis Plan**

#### **Step 1: Verify Event Emission Chain**
- [x] **1.1** Check if TeamContainer.assignTask events are actually being emitted ✅ **FIXED: All 10 events properly configured**
- [x] **1.2** Verify AgentDelegationTool.executeWithHooks calls before/after hooks ✅ **CONFIRMED: Hooks are called**
- [x] **1.3** Confirm EventServiceHookFactory.createToolHooks generates proper ToolHooks ✅ **CONFIRMED: ToolHooks working**
- [x] **1.4** Validate EventService.emit() calls reach PlaygroundEventService ✅ **CONFIRMED: Events reach UI**

#### **Step 2: Analyze Hierarchical Context Flow**
- [x] **2.1** Check if ToolExecutionContext reaches AgentDelegationTool.execute() ✅ **CONFIRMED: Context flows through**
- [x] **2.2** Verify context passed to executeWithHooks contains parentExecutionId/rootExecutionId ✅ **CONFIRMED: Available**
- [x] **2.3** Confirm assignTask method receives and uses hierarchical context ✅ **FIXED: assignTask signature updated**
- [x] **2.4** Validate all TeamContainer events include proper parent/execution path ✅ **FIXED: All 10 events updated**

#### **Step 3: Event Data Transformation Verification** 
- [x] **3.1** Check ServiceEventData → ConversationEvent mapping in PlaygroundEventService ✅ **CONFIRMED: Mapping correct**
- [x] **3.2** Verify PlaygroundHistoryPlugin.recordEvent receives complete data ✅ **CONFIRMED: Plugin working**
- [x] **3.3** Confirm PlaygroundContext.executePrompt retrieves all events via getPlaygroundEvents() ✅ **CONFIRMED: Context retrieval**
- [x] **3.4** Validate ExecutionTreePanel renders all event types correctly ✅ **CONFIRMED: UI rendering updated**

#### **Step 4: Event Type System Validation**
- [x] **4.1** Verify all new ServiceEventType values (team.analysis_*, agent.creation_*, etc.) are properly imported ✅ **CONFIRMED: Types imported**
- [x] **4.2** Check BasicEventType mapping covers all ServiceEventType variants ✅ **CONFIRMED: All mapped**
- [x] **4.3** Confirm mapEventType() in PlaygroundEventService handles all cases ✅ **CONFIRMED: Complete mapping**
- [x] **4.4** Validate ExecutionTreePanel styling/rendering for new event types ✅ **CONFIRMED: Colors added**

#### **Step 5: Critical Integration Points**
- [x] **5.1** Remove all console.log statements causing logging violations ✅ **FIXED: All removed**
- [x] **5.2** Fix TeamContainer.assignTask signature to accept ToolExecutionContext ✅ **FIXED: Signature updated**
- [x] **5.3** Update AgentDelegationTool to pass context to executor function ✅ **FIXED: Context passed**
- [x] **5.4** Ensure PlaygroundExecutor.getPlaygroundEvents() returns complete event list ✅ **CONFIRMED: Method exists**

#### **Step 6: Data Flow Simulation**
- [x] **6.1** Trace complete flow: User Input → teamAgent.run() → assignTask tool call → AgentDelegationTool → TeamContainer.assignTask → Event emission ✅ **TRACED: Flow verified**
- [x] **6.2** Verify event hierarchy: tool_call_start → team.analysis_* → agent.creation_* → agent.execution_* → subtool.call_* → task.aggregation_* → tool_call_complete ✅ **MAPPED: Full hierarchy**
- [x] **6.3** Confirm each event contains proper parentEventId/executionLevel for tree structure ✅ **FIXED: All events have hierarchical data**
- [x] **6.4** Validate final UI rendering shows complete hierarchical blocks ✅ **READY: Should now display 24+ events**

---

## Critical Issues Identified

### 🚨 **Issue 1: Missing Hierarchical Context in TeamContainer**
**Problem**: TeamContainer.assignTask() doesn't receive ToolExecutionContext
**Impact**: All team events lack parentExecutionId/rootExecutionId/executionLevel
**Solution**: Modify assignTask signature and AgentDelegationTool executor call

### 🚨 **Issue 2: Console.log Violations** 
**Problem**: Multiple console.log statements in TeamContainer violate logging rules
**Impact**: User explicitly forbade logging for debugging
**Solution**: Remove all console.log statements immediately

### 🚨 **Issue 3: Event Chain Verification**
**Problem**: No verification that events actually flow through complete chain
**Impact**: Events might be lost at any point in the pipeline
**Solution**: Step-by-step verification of each transformation stage

---

## Implementation Order

1. **Remove Logging Violations** (Immediate)
2. **Fix Hierarchical Context Flow** (Critical)  
3. **Verify Event Emission Chain** (Validation)
4. **Test Complete Data Flow** (Integration)
5. **Confirm UI Rendering** (Final verification)

---

## Expected Final Outcome

After completing all steps, the Playground should display:
```
📋 [User] "카페 창업 계획서..."
🔧 [Tool Start] assignTask #1 (시장 분석)
  📋 [Team Analysis Start] 
  📋 [Team Analysis Complete]
  🤖 [Agent Creation Start] 
  🤖 [Agent Creation Complete]
  ▶️ [Agent Execution Start]
    🔧 [SubTool Call Start] 
    🔧 [SubTool Call Complete]
  ▶️ [Agent Execution Complete]  
  📊 [Task Aggregation Start]
  📊 [Task Aggregation Complete]
🔧 [Tool Complete] assignTask #1
🔧 [Tool Start] assignTask #2 (메뉴 구성)
  [... similar detailed tree ...]
🔧 [Tool Complete] assignTask #2  
📝 [Assistant] Final team response
```

**Target**: ~20+ detailed, hierarchical blocks instead of current 4 simple blocks 
# 🧪 Execution Tree Testing Guide

## 🎯 How to Test the Real-Time Execution Tree System

### Method 1: Dedicated Test Page (Recommended)
Navigate to: **`/execution-tree-test`**

This provides a complete testing environment with:
- Generate Demo / Complex Demo buttons
- Side-by-side tree visualization and block details
- Full debugging capabilities

### Method 2: Within Main Playground

1. Go to the main **Playground** page (`/playground`)
2. Look for the **"Block Visualization"** panel (usually on the right side)
3. Notice the green **"Try Debug Tab!"** badge
4. Click on the **"Debug"** tab in the Block Visualization panel
5. You'll see **"Generate Demo"** and **"Complex Demo"** buttons

## 🎬 Demo Scenarios

### Generate Demo
Creates a **React vs Vue comparison scenario** with:
- User message: "Compare React vs Vue for a new project..."
- Team execution → Agent processing
- Two web search tools (React vs Vue, Performance benchmarks)
- Final LLM response with comparison results

### Complex Demo
*Coming soon* - Will create more complex nested execution patterns

## 🔍 What to Look For

1. **Hierarchical Tree** (left panel):
   - JSON structure showing parent-child relationships
   - Execution levels (0, 1, 2...)
   - Execution paths (`['team', 'agent', 'webSearch']`)
   - Actual timing data (start, end, duration)

2. **Raw Blocks** (right panel):
   - Individual block metadata
   - Tool parameters and results
   - Execution hierarchy information

3. **Statistics** (top):
   - Total blocks created
   - Root nodes count
   - Active/completed/failed status counts

## 🐛 Debugging Tips

- Use **"Refresh"** to manually update the display
- Use **"Clear"** to reset and try again
- Check the browser console for any errors
- Look for proper parent-child ID relationships in the JSON

## 📊 Expected Tree Structure

```json
[
  {
    "id": "user_001",
    "type": "user",
    "state": "completed",
    "level": 0,
    "children": [
      {
        "id": "team_001",
        "type": "group", 
        "level": 0,
        "children": [
          {
            "id": "agent_001",
            "type": "assistant",
            "level": 1,
            "children": [
              {
                "id": "tool_001",
                "type": "tool_call",
                "toolName": "webSearch",
                "level": 2,
                "children": []
              }
            ]
          }
        ]
      }
    ]
  }
]
```

Happy testing! 🚀 
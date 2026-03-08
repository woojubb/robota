'use client'

const RULER_COLUMN_WARNING = 80;
const RULER_COLUMN_ERROR = 120;

import { useRef } from 'react'
import Editor, { OnMount } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { WebLogger } from '../../lib/web-logger'
import { defaultCode } from './code-editor-templates'

// Re-export templates for external consumers
export { exampleTemplates } from './code-editor-templates';

type TMonacoTheme = 'vs-dark' | 'light';

function getPreferredMonacoTheme(): TMonacoTheme {
  if (typeof window === 'undefined') {
    return 'light';
  }
  const html = document.documentElement;
  if (html.classList.contains('dark')) {
    return 'vs-dark';
  }
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)')?.matches;
  return prefersDark ? 'vs-dark' : 'light';
}

interface ICodeEditorProps {
  value: string
  onChange: (value: string | undefined) => void
  language?: string
  height?: string
  readOnly?: boolean
}

export function CodeEditor({
  value,
  onChange,
  language = 'typescript',
  height = '100%',
  readOnly = false
}: ICodeEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor

    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: true
    })

    editor.updateOptions({
      fontSize: 14,
      tabSize: 2,
      minimap: { enabled: false },
      automaticLayout: true,
      suggestOnTriggerCharacters: false,
      quickSuggestions: false,
      wordBasedSuggestions: 'off',
      parameterHints: { enabled: false },
      hover: { enabled: false }
    })

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      WebLogger.debug('Save triggered')
    })

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      WebLogger.debug('Run triggered')
    })
  }

  return (
    <div className="w-full h-full border rounded-md overflow-hidden">
      <Editor
        height={height}
        defaultLanguage={language}
        value={value || defaultCode}
        onChange={onChange}
        theme={getPreferredMonacoTheme()}
        onMount={handleEditorDidMount}
        options={{
          readOnly,
          fontFamily: '"Geist Mono", "SF Mono", Monaco, Inconsolata, "Roboto Mono", Consolas, "Courier New", monospace',
          fontSize: 14,
          lineHeight: 20,
          padding: { top: 16, bottom: 16 },
          selectOnLineNumbers: true,
          roundedSelection: false,
          cursorStyle: 'line',
          automaticLayout: true,
          minimap: { enabled: false },
          wordWrap: 'on',
          lineNumbers: 'on',
          rulers: [RULER_COLUMN_WARNING, RULER_COLUMN_ERROR],
          renderLineHighlight: 'line',
          renderWhitespace: 'boundary',
          cursorBlinking: 'blink',
          cursorSmoothCaretAnimation: 'on',
          contextmenu: true,
          mouseWheelZoom: true,
          quickSuggestions: false,
          suggestOnTriggerCharacters: false,
          acceptSuggestionOnEnter: 'off',
          tabCompletion: 'off',
          snippetSuggestions: 'none',
          parameterHints: { enabled: false },
          hover: { enabled: false }
        }}
      />
    </div>
  )
}

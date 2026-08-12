'use client';

import { useEffect, useRef, useState } from 'react';
import type * as MonacoNS from 'monaco-editor';

/**
 * Monaco editor bound to a workspace file.
 *
 * Monaco and its language workers are bundled locally — no CDN — so the IDE
 * works on an air-gapped machine. Worker construction is guarded: if a worker
 * cannot start, the editor still loads with syntax highlighting only.
 */

type Monaco = typeof MonacoNS;

let monacoPromise: Promise<Monaco> | null = null;

function configureWorkers(): void {
  if (typeof window === 'undefined') return;
  const globalScope = window as Window & { MonacoEnvironment?: MonacoNS.Environment };
  if (globalScope.MonacoEnvironment) return;

  globalScope.MonacoEnvironment = {
    getWorker(_moduleId: string, label: string): Worker {
      try {
        if (label === 'typescript' || label === 'javascript') {
          return new Worker(
            new URL('monaco-editor/esm/vs/language/typescript/ts.worker.js', import.meta.url),
            { type: 'module' },
          );
        }
        if (label === 'json') {
          return new Worker(
            new URL('monaco-editor/esm/vs/language/json/json.worker.js', import.meta.url),
            { type: 'module' },
          );
        }
        if (label === 'css' || label === 'scss' || label === 'less') {
          return new Worker(
            new URL('monaco-editor/esm/vs/language/css/css.worker.js', import.meta.url),
            { type: 'module' },
          );
        }
        if (label === 'html' || label === 'handlebars' || label === 'razor') {
          return new Worker(
            new URL('monaco-editor/esm/vs/language/html/html.worker.js', import.meta.url),
            { type: 'module' },
          );
        }
      } catch {
        // fall through to the base worker
      }
      return new Worker(
        new URL('monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url),
        { type: 'module' },
      );
    },
  };
}

async function loadMonaco(): Promise<Monaco> {
  if (!monacoPromise) {
    configureWorkers();
    monacoPromise = import('monaco-editor').then((monaco) => {
      monaco.editor.defineTheme('vision', {
        base: 'vs-dark',
        inherit: true,
        rules: [
          { token: 'comment', foreground: '626b7d' },
          { token: 'string', foreground: '4dd8c0' },
          { token: 'keyword', foreground: '8b7dff' },
          { token: 'number', foreground: 'f0b429' },
        ],
        colors: {
          'editor.background': '#0b0d13',
          'editor.foreground': '#e6e9f0',
          'editorLineNumber.foreground': '#3a4356',
          'editorLineNumber.activeForeground': '#99a1b3',
          'editor.selectionBackground': '#22b8a033',
          'editor.lineHighlightBackground': '#11141c',
          'editorCursor.foreground': '#4dd8c0',
          'editorGutter.background': '#0b0d13',
        },
      });
      return monaco;
    });
  }
  return monacoPromise;
}

export function languageForPath(filePath: string): string {
  const extension = filePath.slice(filePath.lastIndexOf('.') + 1).toLowerCase();
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript',
    cjs: 'javascript', json: 'json', css: 'css', scss: 'scss', html: 'html', md: 'markdown',
    py: 'python', go: 'go', rs: 'rust', java: 'java', cs: 'csharp', sql: 'sql', sh: 'shell',
    yml: 'yaml', yaml: 'yaml', toml: 'ini', xml: 'xml', dockerfile: 'dockerfile',
  };
  return map[extension] ?? 'plaintext';
}

export function CodeEditor({
  path,
  value,
  onChange,
  onSave,
  readOnly = false,
}: {
  path: string;
  value: string;
  onChange?: (value: string) => void;
  onSave?: () => void;
  readOnly?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<MonacoNS.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const [failure, setFailure] = useState<string | null>(null);

  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  useEffect(() => {
    let disposed = false;

    void loadMonaco()
      .then((monaco) => {
        if (disposed || !containerRef.current) return;
        monacoRef.current = monaco;
        const editor = monaco.editor.create(containerRef.current, {
          value,
          language: languageForPath(path),
          theme: 'vision',
          automaticLayout: true,
          fontSize: 12.5,
          fontFamily: 'ui-monospace, SF Mono, JetBrains Mono, Menlo, monospace',
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          renderLineHighlight: 'line',
          padding: { top: 10, bottom: 10 },
          readOnly,
          tabSize: 2,
        });
        editorRef.current = editor;

        editor.onDidChangeModelContent(() => {
          onChangeRef.current?.(editor.getValue());
        });
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
          onSaveRef.current?.();
        });
      })
      .catch((error: unknown) => {
        setFailure(error instanceof Error ? error.message : String(error));
      });

    return () => {
      disposed = true;
      editorRef.current?.dispose();
      editorRef.current = null;
    };
    // The editor instance is created once; content and language are synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync external value/language changes (switching tabs, reloading a file).
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    if (editor.getValue() !== value) editor.setValue(value);
    const model = editor.getModel();
    if (model) monaco.editor.setModelLanguage(model, languageForPath(path));
  }, [value, path]);

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly });
  }, [readOnly]);

  if (failure) {
    return (
      <div className="flex h-full flex-col">
        <div className="border-b border-danger/30 bg-danger/10 px-3 py-2 text-[11.5px] text-danger">
          Monaco failed to load ({failure}). Falling back to a plain text editor.
        </div>
        <textarea
          className="vc-mono h-full w-full resize-none bg-surface p-3 outline-none"
          value={value}
          readOnly={readOnly}
          onChange={(event) => onChange?.(event.target.value)}
        />
      </div>
    );
  }

  return <div ref={containerRef} className="h-full w-full" />;
}

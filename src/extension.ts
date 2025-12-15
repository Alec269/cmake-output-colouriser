// extension.ts
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
   const decorator = new CMakeOutputColorizer();

   // Check all visible editors periodically and on changes
   const checkAllEditors = () => {
      vscode.window.visibleTextEditors.forEach(editor => {
         if (isCMakeOutput(editor)) {
            decorator.colorize(editor);
         }
      });
   };

   // Initial colourization
   checkAllEditors();

   context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(editor => {
         if (editor && isCMakeOutput(editor)) {
            decorator.colorize(editor);
         }
      })
   );

   context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument(event => {
         // Debounce rapid updates
         setTimeout(() => {
            vscode.window.visibleTextEditors.forEach(editor => {
               if (editor.document === event.document && isCMakeOutput(editor)) {
                  decorator.colorize(editor);
               }
            });
         }, 50);
      })
   );

   // Check when visible editors change (e.g., when output pane opens)
   context.subscriptions.push(
      vscode.window.onDidChangeVisibleTextEditors(() => {
         checkAllEditors();
      })
   );

   // Periodic check for output channels that might have been missed
   const interval = setInterval(checkAllEditors, 1000);
   context.subscriptions.push({ dispose: () => clearInterval(interval) });
}

function isCMakeOutput(editor: vscode.TextEditor): boolean {
   const uri = editor.document.uri.toString();
   const title = (editor as any).document.uri.path || '';

   return editor.document.uri.scheme === 'output' ||
      uri.includes('CMake') ||
      uri.includes('cmake') ||
      title.includes('CMake') ||
      title.includes('Build') ||
      editor.document.languageId === 'log';
}

class CMakeOutputColorizer {
   private decorations = new Map<string, vscode.TextEditorDecorationType>();

   constructor() {
      this.createDecorations();
   }

   private createDecorations() {
      // Error patterns - bright red
      this.decorations.set('error', vscode.window.createTextEditorDecorationType({
         color: '#e97272ff',
         fontWeight: 'bold',
         backgroundColor: 'rgba(255, 68, 68, 0.1)'
      }));
      // Warning patterns - bright yellow/orange
      this.decorations.set('warning', vscode.window.createTextEditorDecorationType({
         color: '#f0a86eff',
         fontWeight: 'bold',
         backgroundColor: 'rgba(255, 170, 0, 0.1)'
      }));
      // Success/completed patterns - bright green
      this.decorations.set('success', vscode.window.createTextEditorDecorationType({
         color: '#93cc7cff',
         fontWeight: 'bold'
      }));
      // Info/build patterns - bright cyan
      this.decorations.set('info', vscode.window.createTextEditorDecorationType({
         color: '#b697acff'
      }));
      // File paths - orange
      this.decorations.set('path', vscode.window.createTextEditorDecorationType({
         color: '#65b6b2ff'
      }));
      // Commands/executables - bright yellow
      this.decorations.set('command', vscode.window.createTextEditorDecorationType({
         color: '#d8d86cff'
      }));
      // Timestamps/numbers - light green
      this.decorations.set('number', vscode.window.createTextEditorDecorationType({
         color: '#a79cc7ff'
      }));

      // Brackets and tags
      this.decorations.set('bracket', vscode.window.createTextEditorDecorationType({
         color: '#888888'
      }));
   }

   public colorize(editor: vscode.TextEditor) {
      const text = editor.document.getText();
      const lines = text.split('\n');

      const errorRanges: vscode.Range[] = [];
      const warningRanges: vscode.Range[] = [];
      const successRanges: vscode.Range[] = [];
      const infoRanges: vscode.Range[] = [];
      const pathRanges: vscode.Range[] = [];
      const commandRanges: vscode.Range[] = [];
      const numberRanges: vscode.Range[] = [];
      const bracketRanges: vscode.Range[] = [];

      lines.forEach((line, i) => {
         let skipDetailedColoring = false;

         // Special handling for "Build finished with exit code X"
         const exitCodeMatch = line.match(/\[build\]\s+Build finished with exit code\s+(\d+)/i);
         if (exitCodeMatch) {
            const exitCode = parseInt(exitCodeMatch[1]);
            if (exitCode === 0) {
               successRanges.push(new vscode.Range(i, 0, i, line.length));
            } else {
               errorRanges.push(new vscode.Range(i, 0, i, line.length));
            }
            skipDetailedColoring = true;
         }

         // Check for errors (but not exit code lines already handled)
         else if (/error[:\s]|failed|fatal|exception|\*\*\*/i.test(line)) {
            errorRanges.push(new vscode.Range(i, 0, i, line.length));
            skipDetailedColoring = true;
         }

         // Check for warnings
         else if (/warning[:\s]|warn[:\s]|deprecated/i.test(line)) {
            warningRanges.push(new vscode.Range(i, 0, i, line.length));
            skipDetailedColoring = true;
         }

         // Success patterns - only "Build completed" style messages
         else if (/(Build completed)/i.test(line) && !/error|fail/i.test(line)) {
            successRanges.push(new vscode.Range(i, 0, i, line.length));
         }

         // Info patterns (CMake tags) - lines starting with [...]
         if (/^\[.*?\]\s/.test(line) && !skipDetailedColoring) {
            const bracketMatch = line.match(/^\[.*?\]/);
            if (bracketMatch) {
               bracketRanges.push(new vscode.Range(i, 0, i, bracketMatch[0].length));
            }
         }

         // Apply detailed colorization to non-error/warning lines
         if (!skipDetailedColoring) {
            // File paths - match both Windows (C:\...) and Unix-style (/path/to/file) paths
            // Windows paths: drive letter + colon + backslashes
            const winPathRegex = /[A-Z]:\\(?:[^\s:*?"<>|\r\n]+\\)*[^\s:*?"<>|\r\n\\]+/gi;
            let match;
            while ((match = winPathRegex.exec(line)) !== null) {
               pathRanges.push(new vscode.Range(i, match.index, i, match.index + match[0].length));
            }

            // F unix
            // Unix-style paths: /path/to/file or D:/path/to/file
            const unixPathRegex = /(?:[A-Z]:)?\/(?:[^\s:*?"<>|\r\n]+\/)*[^\s:*?"<>|\r\n\/]+/g;
            while ((match = unixPathRegex.exec(line)) !== null) {
               // Avoid matching timestamps like 00:00:04
               if (!/^\d{2}:\d{2}:\d{2}/.test(match[0])) {
                  pathRanges.push(new vscode.Range(i, match.index, i, match.index + match[0].length));
               }
            }

            // Commands/executables - match .exe, .EXE files
            const commandRegex = /[\w.-]+\.(?:exe|EXE)\b/g;
            while ((match = commandRegex.exec(line)) !== null) {
               commandRanges.push(new vscode.Range(i, match.index, i, match.index + match[0].length));
            }

            // Numbers: timestamps (HH:MM:SS.mmm)
            const timestampRegex = /\b\d{2}:\d{2}:\d{2}(?:\.\d+)?\b/g;
            while ((match = timestampRegex.exec(line)) !== null) {
               numberRanges.push(new vscode.Range(i, match.index, i, match.index + match[0].length));
            }

            // Numbers: percentages like [ 50%]
            const percentRegex = /\[\s*\d+%\s*\]/g;
            while ((match = percentRegex.exec(line)) !== null) {
               numberRanges.push(new vscode.Range(i, match.index, i, match.index + match[0].length));
            }

            // Numbers: exit codes (only when not part of "Build finished")
            if (!/Build finished with exit code/i.test(line)) {
               const exitCodeRegex = /exit(?:ed)? with code:?\s+\d+/gi;
               while ((match = exitCodeRegex.exec(line)) !== null) {
                  numberRanges.push(new vscode.Range(i, match.index, i, match.index + match[0].length));
               }
            }
         }
      });

      // Apply decorations
      editor.setDecorations(this.decorations.get('error')!, errorRanges);
      editor.setDecorations(this.decorations.get('warning')!, warningRanges);
      editor.setDecorations(this.decorations.get('success')!, successRanges);
      editor.setDecorations(this.decorations.get('info')!, infoRanges);
      editor.setDecorations(this.decorations.get('path')!, pathRanges);
      editor.setDecorations(this.decorations.get('command')!, commandRanges);
      editor.setDecorations(this.decorations.get('number')!, numberRanges);
      editor.setDecorations(this.decorations.get('bracket')!, bracketRanges);
   }
}

export function deactivate() { }


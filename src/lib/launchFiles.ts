/**
 * "Open with My Library": when the installed app is chosen for a PDF on Windows or macOS (Chrome / Edge),
 * the browser hands us the files through window.launchQueue. We keep them here until the upload form opens.
 */
let pending: File[] = [];

export const takePendingFiles = (): File[] => {
  const files = pending;
  pending = [];
  return files;
};

interface LaunchParams {
  files: { kind: string; getFile: () => Promise<File> }[];
}

/** Call once. `onFiles` runs when PDFs were opened with the app. */
export function registerLaunchQueue(onFiles: () => void): void {
  const queue = (window as unknown as { launchQueue?: { setConsumer: (fn: (p: LaunchParams) => void) => void } }).launchQueue;
  if (!queue) return;
  queue.setConsumer(async (params) => {
    if (!params.files?.length) return;
    const files: File[] = [];
    for (const handle of params.files) {
      try {
        const f = await handle.getFile();
        if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') files.push(f);
      } catch {
        /* a file that can't be read is skipped */
      }
    }
    if (files.length) {
      pending = [...pending, ...files];
      onFiles();
    }
  });
}

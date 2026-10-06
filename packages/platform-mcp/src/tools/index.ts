import deployApp from './deploy-app.js';
import driveList from './drive-list.js';
import driveRead from './drive-read.js';
import driveWrite from './drive-write.js';
import listApps from './list-apps.js';
import runApp from './run-app.js';
import stopApp from './stop-app.js';
import type { ToolDef } from './types.js';

/** Registration list only; each tool lives in its own file (04-api.md §6). */
export const tools: ToolDef[] = [runApp, stopApp, deployApp, listApps, driveList, driveRead, driveWrite] as unknown as ToolDef[];

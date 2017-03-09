/*--------------------------------------------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *-------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";

import { ArduinoApp } from "./arduino/arduino";
import { ArduinoContentProvider } from "./arduino/arduinoContentProvider";
import { BoardManager } from "./arduino/boardManager";
import { LibraryManager } from "./arduino/libraryManager";
import { ArduinoSettings } from "./arduino/settings";
import { ARDUINO_MANAGER_PROTOCOL, ARDUINO_MODE, BOARD_MANAGER_URI, LIBRARY_MANAGER_URI } from "./common/constants";
import { DeviceContext } from "./deviceContext";
import { ClangProvider } from "./langService/clang";
import { ClangFormatter } from "./langService/clangFormatter";
import { CompletionProvider } from "./langService/completionProvider";
import { DefinitionProvider } from "./langService/definitionProvider";
import { FormatterProvider } from "./langService/formatterProvider";
import { SerialMonitor } from "./serialmonitor/serialMonitor";
import Logger from './logger/logger-wrapper'

export async function activate(context: vscode.ExtensionContext) {
    Logger.configure(context);
    Logger.traceUserData("start-activate-extension");
    const arduinoSettings = new ArduinoSettings();
    await arduinoSettings.initialize();
    const arduinoApp = new ArduinoApp(arduinoSettings);
    await arduinoApp.initialize();

    // TODO: After use the device.json config, should remove the dependency on the ArduinoApp object.
    let deviceContext = DeviceContext.getIntance();
    deviceContext.arduinoApp = arduinoApp;
    await deviceContext.loadContext();
    context.subscriptions.push(deviceContext);

    // Arduino board manager & library manager
    const boardManager = new BoardManager(arduinoSettings, arduinoApp);
    arduinoApp.boardManager = boardManager;
    await boardManager.loadPackages();
    const libraryManager = new LibraryManager(arduinoSettings, arduinoApp);

    const arduinoManagerProvider = new ArduinoContentProvider(arduinoApp, boardManager, libraryManager, context.extensionPath);
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(ARDUINO_MANAGER_PROTOCOL, arduinoManagerProvider));

    let myregisterCommand = (command: string, callback: (...args: any[]) => any, getUserData?: () => any): vscode.Disposable => {
        return vscode.commands.registerCommand(command, async () => {
            Logger.traceUserData(`start-command-` + command);
            let timer1 = new Logger.Timer();
            let result = callback();
            if (result) {
                await Promise.resolve(result);
            }

            Logger.traceUserData(`end-command-` + command, { duration: timer1.end() });
        });
    };
    context.subscriptions.push(myregisterCommand("arduino.showBoardManager", () => {
        return vscode.commands.executeCommand("vscode.previewHtml", BOARD_MANAGER_URI, vscode.ViewColumn.Two, "Arduino Boards Manager");
    }));

    context.subscriptions.push(myregisterCommand("arduino.showLibraryManager", () => {
        return vscode.commands.executeCommand("vscode.previewHtml", LIBRARY_MANAGER_URI, vscode.ViewColumn.Two, "Arduino Library Manager");
    }));

    // change board type
    context.subscriptions.push(myregisterCommand("arduino.changeBoardType", async () => {
        await boardManager.changeBoardType();
        arduinoManagerProvider.update(LIBRARY_MANAGER_URI);
    }, () => {
        return { board: boardManager.currentBoard.name };
    }));

    context.subscriptions.push(myregisterCommand("arduino.verify", () => arduinoApp.verify(), () => {
        return { board: boardManager.currentBoard.name };
    }));

    context.subscriptions.push(myregisterCommand("arduino.upload", () => arduinoApp.upload(),
        () => {
            return { board: boardManager.currentBoard.name };
        }));

    context.subscriptions.push(myregisterCommand("arduino.addLibPath", (path) => arduinoApp.addLibPath(path)));
    context.subscriptions.push(myregisterCommand("arduino.installBoard", async (packageName, arch, version?: string) => {
        await arduinoApp.installBoard(packageName, arch, version);
        arduinoManagerProvider.update(BOARD_MANAGER_URI);
        return { telemetry: true, packageName, arch, version };
    }));
    context.subscriptions.push(myregisterCommand("arduino.uninstallBoard", (packagePath) => {
        arduinoApp.uninstallBoard(packagePath);
        arduinoManagerProvider.update(BOARD_MANAGER_URI);
        return { telemetry: true, packagePath };
    }));
    context.subscriptions.push(myregisterCommand("arduino.installLibrary", async (libName, version?: string) => {
        await arduinoApp.installLibrary(libName, version);
        arduinoManagerProvider.update(LIBRARY_MANAGER_URI);
        return { telemetry: true, libName, version };
    }));
    context.subscriptions.push(myregisterCommand("arduino.uninstallLibrary", (libPath) => {
        arduinoApp.uninstallLibrary(libPath);
        arduinoManagerProvider.update(LIBRARY_MANAGER_URI);
        return { telemetry: true, libPath };
    }));

    // serial monitor commands
    const monitor = new SerialMonitor();
    context.subscriptions.push(myregisterCommand("arduino.selectSerialPort", async () => {
        await monitor.selectSerialPort();
    }));
    context.subscriptions.push(myregisterCommand("arduino.openSerialMonitor", async () => {
        await monitor.openSerialMonitor();
    }));
    context.subscriptions.push(myregisterCommand("arduino.changeBaudRate", async () => {
        await monitor.changeBaudRate();
    }));
    context.subscriptions.push(myregisterCommand("arduino.sendMessageToSerialPort", async () => {
        await monitor.sendMessageToSerialPort();
    }));
    context.subscriptions.push(myregisterCommand("arduino.closeSerialMonitor", async () => {
        await monitor.closeSerialMonitor();
    }));

    // Add arduino specific language suport.
    const clangProvider = new ClangProvider(arduinoApp);
    clangProvider.initialize();
    const completionProvider = new CompletionProvider(clangProvider);
    context.subscriptions.push(clangProvider);
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(ARDUINO_MODE, completionProvider, "<", '"', "."));
    const definitionProvider = new DefinitionProvider(clangProvider);
    context.subscriptions.push(vscode.languages.registerDefinitionProvider(ARDUINO_MODE, definitionProvider));
    const clangFormatter = new ClangFormatter(arduinoSettings);
    const formatterProvider = new FormatterProvider(clangFormatter);
    context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider(ARDUINO_MODE, formatterProvider));

    // Example explorer, only work under VSCode insider version.
    if (typeof vscode.window.registerTreeExplorerNodeProvider === "function"
        && vscode.version.indexOf("insider") > -1) {
        const exampleProvider = require("./arduino/exampleProvider");
        vscode.window.registerTreeExplorerNodeProvider("arduinoExampleTree", new exampleProvider.ExampleProvider(arduinoSettings));
        // This command will be invoked using exactly the node you provided in `resolveChildren`.
        myregisterCommand("arduino.openExample", (node) => {
            if (node.kind === "leaf") {
                vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(node.fullPath), true);
            }
        });
    }
    Logger.traceUserData("end-activate-extension");
}


export function deactivate() {
    Logger.traceUserData('deactivate-extension');
}
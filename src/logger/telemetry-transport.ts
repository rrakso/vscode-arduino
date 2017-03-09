import * as vscode from 'vscode'
import TelemetryReporter from 'vscode-extension-telemetry'
import * as winston from 'winston';
interface IPackageInfo {
    name: string;
    version: string;
    aiKey: string;
}

function getPackageInfo(context: vscode.ExtensionContext): IPackageInfo {
    let extensionPackage = require(context.asAbsolutePath('./package.json'));
    if (extensionPackage) {
        return {
            name: extensionPackage.name,
            version: extensionPackage.version,
            aiKey: extensionPackage.aiKey
        };
    }
}

function isNumeric(n) {
    return !isNaN(parseFloat(n)) && isFinite(n);
}

export class TelemetryTransport extends winston.Transport {
    private name: string;
    private reporter: TelemetryReporter;
    constructor(options: any) {
        super({...options, context: null});
        this.name = 'telemetry';
        if (!options.context) {
            console.log('Failed to initialize telemetry, please set the vscode context in options.');
            return;
        }
        let packageInfo = getPackageInfo(options.context);
        if (!packageInfo.aiKey) {
            console.log('Failed to initialize telemetry due to no aiKey in package.json.');
            return;
        }
        this.reporter = new TelemetryReporter(packageInfo.name, packageInfo.version, packageInfo.aiKey);

    }

    log(level: string, msg: string, meta?: any, callback?: Function) {
        if (this.reporter && meta && meta.telemetry) {
            try {
                delete meta.telemetry;
                let properties: { [key: string]: string; } = {};
                let measures: { [key: string]: number; } = {};
                for (let key in Object.keys(meta)) {
                    if (typeof key == 'string' || key instanceof String) {
                        let value = meta[key];
                        if (value == null || typeof value == 'string' || value instanceof String) {
                            properties[key] = value;
                        } else if (isNumeric(value)) {
                            measures[key] = value;
                        } else {
                            console.log(`Ingore log(${key} = ${value}) since the value type are not supported.`);
                        }
                    }
                }
                this.reporter.sendTelemetryEvent(msg, properties, measures);
            } catch (telemetryErr) {
                // If sending telemetry event fails ignore it so it won't break the extension
                console.log('Failed to send telemetry event. error: ' + telemetryErr);
            }
        }
        super.emit('logged');
        callback(null, true);
    }
}

export default TelemetryTransport;
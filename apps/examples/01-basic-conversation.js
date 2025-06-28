"use strict";
/**
 * 01-basic-conversation.ts
 *
 * This example demonstrates the most basic usage of Robota:
 * - Simple conversation using OpenAI
 * - Message sending and responses
 * - Proper error handling
 * - Basic statistics and resource management
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var openai_1 = require("openai");
var agents_1 = require("@robota-sdk/agents");
var openai_2 = require("@robota-sdk/openai");
var dotenv_1 = require("dotenv");
// Load environment variables from examples directory
dotenv_1.default.config();
function main() {
    return __awaiter(this, void 0, void 0, function () {
        var apiKey, openaiClient, openaiProvider, robota, query, response, stats, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 3, , 4]);
                    console.log('🤖 Basic Conversation Example Started...\n');
                    apiKey = process.env.OPENAI_API_KEY;
                    if (!apiKey) {
                        throw new Error('OPENAI_API_KEY environment variable is required');
                    }
                    openaiClient = new openai_1.default({ apiKey: apiKey });
                    openaiProvider = new openai_2.OpenAIProvider({
                        client: openaiClient,
                        model: 'gpt-3.5-turbo'
                    });
                    robota = new agents_1.Robota({
                        name: 'BasicAgent',
                        model: 'gpt-3.5-turbo',
                        provider: 'openai',
                        aiProviders: {
                            'openai': openaiProvider
                        },
                        currentProvider: 'openai',
                        currentModel: 'gpt-3.5-turbo',
                        systemMessage: 'You are a helpful AI assistant. Provide concise and useful responses.'
                    });
                    // === Optimized Conversation for Token Efficiency ===
                    console.log('📝 Simple Question:');
                    query = 'Hi, what is TypeScript?';
                    console.log("User: ".concat(query));
                    return [4 /*yield*/, robota.run(query)];
                case 1:
                    response = _a.sent();
                    console.log("Assistant: ".concat(response, "\n"));
                    // === Show Statistics ===
                    console.log('📊 Session Statistics:');
                    stats = robota.getStats();
                    console.log("- Agent name: ".concat(stats.name));
                    console.log("- Current provider: ".concat(stats.currentProvider));
                    console.log("- History length: ".concat(stats.historyLength));
                    console.log("- Available tools: ".concat(stats.tools.length));
                    console.log("- Plugins: ".concat(stats.plugins.length));
                    console.log("- Uptime: ".concat(Math.round(stats.uptime), "ms\n"));
                    console.log('✅ Basic Conversation Example Completed!');
                    // Clean up resources
                    return [4 /*yield*/, robota.destroy()];
                case 2:
                    // Clean up resources
                    _a.sent();
                    // Ensure process exits cleanly
                    console.log('🧹 Cleanup completed. Exiting...');
                    process.exit(0);
                    return [3 /*break*/, 4];
                case 3:
                    error_1 = _a.sent();
                    console.error('❌ Error occurred:', error_1);
                    if (error_1 instanceof Error) {
                        console.error('Stack trace:', error_1.stack);
                    }
                    process.exit(1);
                    return [3 /*break*/, 4];
                case 4: return [2 /*return*/];
            }
        });
    });
}
// Execute
main();

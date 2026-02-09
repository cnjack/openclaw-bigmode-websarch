import { Type, type Static } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

// Plugin configuration interface
interface PluginConfig {
    enabled?: boolean;
    apiKey?: string;
    defaultSearchEngine?: "search_std" | "search_pro" | "search_pro_sogou" | "search_pro_quark";
    defaultCount?: number;
}

// Plugin config schema
const pluginConfigSchema = {
    parse(value: unknown): PluginConfig {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            return {};
        }
        const cfg = value as Record<string, unknown>;
        
        // Validate allowed keys
        const allowedKeys = ["enabled", "apiKey", "defaultSearchEngine", "defaultCount"];
        const unknownKeys = Object.keys(cfg).filter(k => !allowedKeys.includes(k));
        if (unknownKeys.length > 0) {
            throw new Error(`Unknown config keys: ${unknownKeys.join(", ")}`);
        }
        
        return {
            enabled: typeof cfg.enabled === "boolean" ? cfg.enabled : undefined,
            apiKey: typeof cfg.apiKey === "string" ? cfg.apiKey : undefined,
            defaultSearchEngine:
                cfg.defaultSearchEngine === "search_std" ||
                cfg.defaultSearchEngine === "search_pro" ||
                cfg.defaultSearchEngine === "search_pro_sogou" ||
                cfg.defaultSearchEngine === "search_pro_quark"
                    ? cfg.defaultSearchEngine
                    : undefined,
            defaultCount:
                typeof cfg.defaultCount === "number" && 
                cfg.defaultCount >= 1 && 
                cfg.defaultCount <= 50
                    ? cfg.defaultCount
                    : undefined,
        };
    },
    uiHints: {
        apiKey: {
            label: "BigModel API Key",
            help: "API key from https://bigmodel.cn/usercenter/proj-mgmt/apikeys",
            sensitive: true,
        },
        defaultSearchEngine: {
            label: "Default Search Engine",
            help: "Default search engine: search_std (standard), search_pro (advanced), search_pro_sogou (Sogou), search_pro_quark (Quark)",
        },
        defaultCount: {
            label: "Default Result Count",
            help: "Default number of results to return (1-50)",
        },
    },
};

// BigModel API types
const SearchEngineEnum = Type.Union([
    Type.Literal("search_std"),
    Type.Literal("search_pro"),
    Type.Literal("search_pro_sogou"),
    Type.Literal("search_pro_quark"),
]);

const RecencyFilterEnum = Type.Union([
    Type.Literal("oneDay"),
    Type.Literal("oneWeek"),
    Type.Literal("oneMonth"),
    Type.Literal("oneYear"),
    Type.Literal("noLimit"),
]);

const ContentSizeEnum = Type.Union([
    Type.Literal("medium"),
    Type.Literal("high"),
]);

// Tool parameters schema
const WebSearchParameters = Type.Object({
    query: Type.String({
        description:
            "The search query to perform, recommended to be less than 70 characters",
    }),
    search_engine: Type.Optional(
        Type.Union([SearchEngineEnum], {
            description:
                "Search engine to use: search_std (standard), search_pro (advanced), search_pro_sogou (Sogou), search_pro_quark (Quark)",
            default: "search_std",
        })
    ),
    count: Type.Optional(
        Type.Number({
            description: "Number of results to return (1-50, default 10)",
            minimum: 1,
            maximum: 50,
            default: 10,
        })
    ),
    search_recency_filter: Type.Optional(
        Type.Union([RecencyFilterEnum], {
            description:
                "Time filter: oneDay, oneWeek, oneMonth, oneYear, noLimit (default)",
            default: "noLimit",
        })
    ),
    content_size: Type.Optional(
        Type.Union([ContentSizeEnum], {
            description:
                "Content detail level: medium (summary) or high (detailed)",
            default: "medium",
        })
    ),
    search_domain_filter: Type.Optional(
        Type.String({
            description: "Limit search results to specific domain (e.g., example.com)",
        })
    ),
});

type WebSearchParams = Static<typeof WebSearchParameters>;

// BigModel API response types
interface SearchIntentItem {
    query: string;
    intent: "SEARCH_ALL" | "SEARCH_NONE" | "SEARCH_ALWAYS";
    keywords?: string;
}

interface SearchResultItem {
    title: string;
    content: string;
    link: string;
    media?: string;
    icon?: string;
    refer?: string;
    publish_date?: string;
}

interface WebSearchResponse {
    id: string;
    created: number;
    request_id?: string;
    search_intent?: SearchIntentItem[];
    search_result: SearchResultItem[];
}

interface BigModelErrorResponse {
    error?: {
        message: string;
        code?: string;
    };
}

// API constants
const BIGMODEL_API_URL = "https://open.bigmodel.cn/api/paas/v4/web_search";

/**
 * Perform web search using BigModel API
 */
async function performWebSearch(
    params: WebSearchParams,
    apiKey: string
): Promise<WebSearchResponse> {
    const requestBody = {
        search_query: params.query,
        search_engine: params.search_engine ?? "search_std",
        search_intent: false,
        count: params.count ?? 10,
        search_recency_filter: params.search_recency_filter ?? "noLimit",
        content_size: params.content_size ?? "medium",
        ...(params.search_domain_filter && {
            search_domain_filter: params.search_domain_filter,
        }),
    };

    const response = await fetch(BIGMODEL_API_URL, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as BigModelErrorResponse;
        const errorMessage = errorData.error?.message ?? `HTTP ${response.status}`;
        throw new Error(`BigModel API error: ${errorMessage}`);
    }

    const data = (await response.json()) as WebSearchResponse;
    return data;
}

/**
 * Format search results for LLM consumption
 */
function formatSearchResults(results: SearchResultItem[]): string {
    if (results.length === 0) {
        return "No search results found.";
    }

    return results
        .map((result, index) => {
            const parts = [`[${index + 1}] ${result.title}`];
            if (result.media) {
                parts.push(`Source: ${result.media}`);
            }
            if (result.publish_date) {
                parts.push(`Published: ${result.publish_date}`);
            }
            parts.push(`URL: ${result.link}`);
            parts.push(`Content: ${result.content}`);
            return parts.join("\n");
        })
        .join("\n\n---\n\n");
}

/**
 * BigModel Web Search plugin for OpenClaw
 */
const bigmodelWebSearchPlugin = {
    id: "openclaw-bigmodel-search",
    name: "OpenClaw BigModel Web Search",
    description: "Web search tool powered by BigModel AI Web Search API",
    version: "1.0.0",
    configSchema: pluginConfigSchema,
    register(api: OpenClawPluginApi): void {
        const pluginConfig = pluginConfigSchema.parse(api.pluginConfig);

        api.registerTool({
            name: "web-search",
            label: "Web Search",
            description:
                "Search the web using BigModel AI search engine. Returns structured search results with titles, URLs, and content summaries optimized for AI processing. Supports multiple search engines (standard, pro, Sogou, Quark) and time/domain filters.",
            parameters: WebSearchParameters,
            async execute(_id, params) {
                // Get API key from plugin config or environment variable
                const apiKey = pluginConfig.apiKey ?? process.env.BIGMODEL_API_KEY;
                if (!apiKey) {
                    return {
                        content: [
                            {
                                type: "text" as const,
                                text: "Error: BigModel API key is not configured. Please set it in plugin config (plugins.entries.bigmodel-web-search.config.apiKey) or BIGMODEL_API_KEY environment variable.",
                            },
                        ],
                        details: { error: true, message: "API key not configured" },
                    };
                }

                // Apply plugin config defaults
                const searchParams = {
                    ...params,
                    search_engine: params.search_engine ?? pluginConfig.defaultSearchEngine ?? "search_std",
                    count: params.count ?? pluginConfig.defaultCount ?? 10,
                };

                try {
                    const response = await performWebSearch(searchParams, apiKey);
                    const formattedResults = formatSearchResults(response.search_result);

                    return {
                        content: [
                            {
                                type: "text" as const,
                                text: `## Web Search Results for: "${params.query}"\n\n${formattedResults}`,
                            },
                        ],
                        details: {
                            query: params.query,
                            resultCount: response.search_result.length,
                            searchEngine: searchParams.search_engine,
                        },
                    };
                } catch (error) {
                    const errorMessage =
                        error instanceof Error ? error.message : String(error);
                    return {
                        content: [
                            {
                                type: "text" as const,
                                text: `Error performing web search: ${errorMessage}`,
                            },
                        ],
                        details: { error: true, message: errorMessage },
                    };
                }
            },
        });
    },
};

export default bigmodelWebSearchPlugin;

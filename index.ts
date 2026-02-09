import { Type, type Static } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

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
 * OpenClaw plugin entry point
 */
export default function (api: OpenClawPluginApi): void {
    api.registerTool({
        name: "bigmodel_web_search",
        label: "BigModel Web Search",
        description:
            "Search the web using BigModel AI search engine. Returns structured search results with titles, URLs, and content summaries optimized for AI processing. Supports multiple search engines (standard, pro, Sogou, Quark) and time/domain filters.",
        parameters: WebSearchParameters,
        async execute(_id, params) {
            // Get API key from environment
            const apiKey = process.env.BIGMODEL_API_KEY;
            if (!apiKey) {
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: "Error: BIGMODEL_API_KEY environment variable is not set. Please set it to use the BigModel web search API.",
                        },
                    ],
                    details: { error: true, message: "API key not set" },
                };
            }

            try {
                const response = await performWebSearch(params, apiKey);
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
                        searchEngine: params.search_engine ?? "search_std",
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
}

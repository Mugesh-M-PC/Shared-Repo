// Shared HTTP client used by every CRM API operation. It adds query-string
// parameters, retries empty/invalid JSON responses, and returns a consistent
// { status, body } object to callers.

/** Send one API request through Playwright's authenticated request context. */
async function sendApiRequest(request, options) {
    const {
        method = 'GET',
        url,
        query = {},
        headers = {},
        data,
        form,
        retries = 2,
        allowEmptyResponse = false,
    } = options;
    const requestUrl = new URL(url);

    // Add only defined query values so optional parameters are truly omitted.
    for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) {
            requestUrl.searchParams.set(key, String(value));
        }
    }

    // retries is the number of retries after the first attempt.
    for (let attempt = 0; attempt <= retries; attempt += 1) {
        const response = await request.fetch(requestUrl.toString(), {
            method,
            headers,
            data,
            form,
        });
        const contentType = response.headers()['content-type'] ?? '';
        const responseText = await response.text();
        const isLastAttempt = attempt === retries;

        // HTTP errors are definitive and should not be hidden by a retry.
        if (!response.ok()) {
            throw new Error(
                `${method} ${requestUrl.pathname} failed with ${response.status()}: ${responseText}`
            );
        }

        // Some CRM responses are temporarily empty; retry those before failing.
        if (!responseText.trim()) {
            if (!isLastAttempt) {
                await new Promise((resolve) => setTimeout(resolve, 500));
                continue;
            }
            if (allowEmptyResponse) {
                return {
                    status: response.status(),
                    body: null,
                };
            }
            throw new Error(
                `${method} ${requestUrl.pathname} returned an empty response body after ${retries + 1} attempts.`
            );
        }

        // Preserve non-JSON responses as text and parse JSON responses safely.
        let body = responseText;
        if (contentType.includes('application/json')) {
            try {
                body = JSON.parse(responseText);
            } catch (error) {
                if (!isLastAttempt) {
                    await new Promise((resolve) => setTimeout(resolve, 500));
                    continue;
                }
                throw new Error(
                    `${method} ${requestUrl.pathname} returned invalid JSON after ${retries + 1} attempts: ${error.message}`
                );
            }
        }

        return {
            status: response.status(),
            body,
        };
    }
}

module.exports = { sendApiRequest };

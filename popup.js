document.getElementById("summarize").addEventListener("click", async () => {
  const resultDiv = document.getElementById("result");
  resultDiv.innerHTML = '<div class="loading"><div class="loader"></div></div>';

  const summaryType = document.getElementById("summary-type").value;

  // Get API key from storage
  chrome.storage.sync.get(["geminiApiKey"], async (result) => {
    if (!result.geminiApiKey) {
      resultDiv.innerHTML =
        "API key not found. Please set your API key in the extension options.";
      return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      // Step 1: Attempt to send the message
      chrome.tabs.sendMessage(
        tab.id,
        { type: "GET_ARTICLE_TEXT" },
        async (res) => {
          // Check for the error *immediately* after the message attempt
          if (chrome.runtime.lastError) {
            // This means the listener in content.js did not exist (the page wasn't ready or is a restricted page)
            console.log(
              "Content script not found, injecting now:",
              chrome.runtime.lastError.message
            );

            // Define the function that content.js currently does (you need to move the content of content.js here)
            // Since content.js is a separate file, we will inject it.

            try {
              const injectionResults = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ["content.js"],
              });

              // Now that content.js is loaded, attempt the sendMessage again (recursively or repeat logic)
              // To avoid complexity, we can directly run the getArticleText function content here:
              const getArticleTextFunction = () => {
                const article = document.querySelector("article");
                if (article) return article.innerText;

                const paragraphs = Array.from(document.querySelectorAll("p"));
                return paragraphs.map((p) => p.innerText).join("\n");
              };

              const directInjectionResults =
                await chrome.scripting.executeScript({
                  target: { tabId: tab.id },
                  func: getArticleTextFunction, // Run the function directly
                });

              const articleText = directInjectionResults[0].result;

              if (!articleText) {
                resultDiv.innerText =
                  "Could not extract article text from this page after manual injection.";
                return;
              }

              // Proceed with API call
              const summary = await getGeminiSummary(
                articleText,
                summaryType,
                result.geminiApiKey
              );
              resultDiv.innerText = summary;
            } catch (error) {
              resultDiv.innerText = `Error after manual injection: ${
                error.message || "Failed to inject content script."
              }`;
            }
            return; // Stop the original flow
          }

          // This is the success path (content.js was already running)
          if (!res || !res.text) {
            resultDiv.innerText =
              "Could not extract article text from this page.";
            return;
          } // Proceed with API call

          try {
            const summary = await getGeminiSummary(
              res.text,
              summaryType,
              result.geminiApiKey
            );
            resultDiv.innerText = summary;
          } catch (error) {
            resultDiv.innerText = `Error: ${
              error.message || "Failed to generate summary."
            }`;
          }
        }
      );
    });
  });
});

document.getElementById("copy-btn").addEventListener("click", () => {
  const summaryText = document.getElementById("result").innerText;

  if (summaryText && summaryText.trim() !== "") {
    navigator.clipboard
      .writeText(summaryText)
      .then(() => {
        const copyBtn = document.getElementById("copy-btn");
        const originalText = copyBtn.innerText;

        copyBtn.innerText = "Copied!";
        setTimeout(() => {
          copyBtn.innerText = originalText;
        }, 2000);
      })
      .catch((err) => {
        console.error("Failed to copy text: ", err);
      });
  }
});

async function getGeminiSummary(text, summaryType, apiKey) {
  // Truncate very long texts to avoid API limits (typically around 30K tokens)
  const maxLength = 20000;
  const truncatedText =
    text.length > maxLength ? text.substring(0, maxLength) + "..." : text;

  let prompt;
  switch (summaryType) {
    case "brief":
      prompt = `Provide a brief summary of the following article in 2-3 sentences:\n\n${truncatedText}`;
      break;
    case "detailed":
      prompt = `Provide a detailed summary of the following article, covering all main points and key details:\n\n${truncatedText}`;
      break;
    case "bullets":
      prompt = `Summarize the following article in 5-7 key points. Format each point as a line starting with "- " (dash followed by a space). Do not use asterisks or other bullet symbols, only use the dash. Keep each point concise and focused on a single key insight from the article:\n\n${truncatedText}`;
      break;
    default:
      prompt = `Summarize the following article:\n\n${truncatedText}`;
  }

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature: 0.2,
          },
        }),
      }
    );

    if (!res.ok) {
      const errorData = await res.json();
      throw new Error(errorData.error?.message || "API request failed");
    }

    const data = await res.json();
    return (
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "No summary available."
    );
  } catch (error) {
    console.error("Error calling Gemini API:", error);
    throw new Error("Failed to generate summary. Please try again later.");
  }
}

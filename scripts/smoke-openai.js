const { callAIModel, loadAIConfig, getAIConfig } = require('../routes/ai');

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.log('OPENAI_API_KEY is not set, skip smoke test.');
    return;
  }

  loadAIConfig();
  const config = getAIConfig();
  console.log(`[Smoke] Calling OpenAI model: ${config.model}`);
  const result = await callAIModel('请用一句中文回复：WebStock OpenAI smoke test passed');
  console.log(result);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

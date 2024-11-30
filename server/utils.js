const axios = require("axios");
const https = require("https");
const { Readable } = require('stream');

require("dotenv").config();

// 网页爬取函数
async function crawlWebPage(url) {
  console.log("正在爬取网页:", url);

  try {
    const response = await axios.post(
      "http://127.0.0.1:2918/web-crawling",
      { url },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
    console.log("爬取网页成功:", response.data.text);
    return response.data.text;
  } catch (error) {
    console.error("爬取网页失败:", error.response?.data || error.message);
    throw new Error("网页爬取失败");
  }
}

// 将functions定义改为tools格式
const tools = [
  {
    type: "function",
    function: {
      name: "crawl_webpage",
      description: "爬取指定URL的网页内容",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "需要爬取的网页URL",
          },
        },
        required: ["url"],
      },
    },
  },
];

// 更新callOpenAI函数，使其支持流式响应
async function callOpenAI(messages, toolSchemas = null) {
  const requestBody = {
    model: "gpt-4o",
    messages,
    temperature: 0.7,
    stream: true, // 确保开启流式输出
  };

  if (toolSchemas) {
    requestBody.tools = toolSchemas;
    requestBody.tool_choice = "auto";
  }

  console.log('process.env.OPENAI_API_URL', process.env.OPENAI_API_URL);
  

  try {
    const response = await axios({
      method: 'post',
      url: `${process.env.OPENAI_API_URL}/v1/chat/completions`,
      data: requestBody,
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      responseType: 'stream', // 指定响应类型为流
    });

    return response.data; // 返回流式响应
  } catch (error) {
    console.error(
      "OpenAI API 调用失败:",
      error.response?.data || error.message
    );
    throw error;
  }
}

// 更新processUserQuery函数，处理流式响应
function processUserQuery(userInput) {
  const stream = new Readable({
    read() {}
  });
  
  let isFunctionCallInProgress = false;  // 添加标识变量
  let partialData = ''; // Variable to store incomplete data chunks

  (async () => {
    try {
      // 向客户端发送开始处理的通知
      stream.push(formatStreamResponse('progress', '正在处理您的请求...'));

      // 调用callOpenAI，获取流式响应
      const responseStream = await callOpenAI(
        [{ role: "user", content: userInput }],
        tools
      );

      let collectingFunctionArgs = false;
      let functionArgsData = '';
      let functionCall = null;

      // 处理流式响应
      responseStream.on('data', (chunk) => {
        partialData += chunk.toString(); // Append the new chunk to partialData

        let lines = partialData.split('\n'); // Split the accumulated data by new lines
        partialData = lines.pop(); // Remove the last line (which might be incomplete) and keep it in partialData

        for (const line of lines) {
          if (line.trim().startsWith('data: ')) {
            const data = line.replace('data: ', '').trim();
            if (data === '[DONE]') {
              // 只有在不是function call进行中时才发送完成消息
              if (!isFunctionCallInProgress) {
                stream.push(formatStreamResponse('done', '处理完成'));
                stream.push(null);
              }
              return;
            } else {
              if(data === '{"error":"Unknown Error"}') {
                stream.push(formatStreamResponse('progress', '未知错误，请重试'));
                stream.push(null);
                return;
              }
              try {
                const parsed = JSON.parse(data);
                const delta = parsed.choices[0].delta;

                // 检查是否有工具调用
                if (delta.tool_calls && delta.tool_calls[0]) {
                  isFunctionCallInProgress = true;
                  const toolCallDelta = delta.tool_calls[0];

                  // 如果存在函数调用的参数
                  if (toolCallDelta.function && toolCallDelta.function.arguments !== undefined) {
                    // 开始或继续收集函数参数
                    if (!collectingFunctionArgs) {
                      collectingFunctionArgs = true;
                      functionArgsData = '';
                      functionCall = {
                        type: toolCallDelta.type,
                        function: {
                          name: toolCallDelta.function.name,
                          arguments: ''
                        },
                        id: toolCallDelta.id
                      };
                    }
                    // 拼接参数
                    functionArgsData += toolCallDelta.function.arguments;
                  }
                } else {
                  // 如果之前在收集函数参数，且现在没有新的参数，说明参数收集完成
                  if (collectingFunctionArgs) {
                    collectingFunctionArgs = false;
                    try {
                      const functionArgs = JSON.parse(functionArgsData);

                      // 通知客户端正在检索网页
                      stream.push(formatStreamResponse('progress', '正在检索网页...'));
                      crawlWebPage(functionArgs.url).then(async (webContent) => {
                        // 将爬取结果发送回GPT-4进行处理
                        stream.push(formatStreamResponse('progress', '网页检索完毕，正在处理网页内容...'));
                        const secondResponseStream = await callOpenAI([
                          { role: "user", content: userInput },
                          { role: "assistant", content: '', tool_calls: [functionCall] },
                          {
                            role: "tool",
                            tool_call_id: functionCall.id,
                            name: "crawl_webpage",
                            content: webContent,
                          },
                        ]);

                        // 处理二次流式响应
                        secondResponseStream.on('data', (chunk) => {
                          const lines = chunk.toString().split('\n');
                          for (const line of lines) {
                            if (line.trim().startsWith('data: ')) {
                              const data = line.replace('data: ', '').trim();
                              if (data === '[DONE]') {
                                // function call 完成后发送完成消息
                                isFunctionCallInProgress = false;
                                stream.push(formatStreamResponse('done', '处理完成'));
                                stream.push(null);
                                return;
                              } else {
                                try {
                                  const parsed = JSON.parse(data);
                                  const delta = parsed.choices[0].delta;
                                  if (delta.content) {
                                    stream.push(formatStreamResponse('message', delta.content));
                                  }
                                } catch (err) {
                                  console.error("解析响应错误:", err);
                                }
                              }
                            }
                          }
                        });
                      }).catch(error => {
                        console.error("爬取网页失败:", error);
                        isFunctionCallInProgress = false;
                        stream.push(formatStreamResponse('error', error.message));
                        stream.push(null);
                      });
                    } catch (err) {
                      console.error("解析函数参数错误:", err);
                      stream.push(formatStreamResponse('error', '解析函数参数失败'));
                      stream.push(null);
                    }
                  }

                  if (delta.content) {
                    // 发送内容更新
                    stream.push(formatStreamResponse('message', delta.content));
                  }
                }
              } catch (err) {
                console.error("解析响应错误:", err);
              }
            }
          }
        }
      });

      responseStream.on('end', () => {
        // Process any remaining data in partialData
        if (partialData.trim() !== '') {
          const line = partialData;
          if (line.trim().startsWith('data: ')) {
            const data = line.replace('data: ', '').trim();
            if (data !== '[DONE]') {
              try {
                const parsed = JSON.parse(data);
                const delta = parsed.choices[0].delta;
                // ... (Your existing processing logic)
              } catch (err) {
                console.error("解析响应错误:", err);
                // Optionally handle parsing errors here
              }
            }
          }
        }

        // Only send 'done' message if not in function call
        if (!isFunctionCallInProgress) {
          stream.push(formatStreamResponse('done', '处理完成'));
          stream.push(null);
        }
      });

      responseStream.on('error', (error) => {
        console.error("流式响应出错:", error);
        stream.push(formatStreamResponse('error', error.message));
        stream.push(null);
      });
    } catch (error) {
      console.error("处理查询失败:", error);
      stream.push(formatStreamResponse('error', error.message));
      stream.push(null);
    }
  })();

  return stream;
}

// 使用示例
async function main() {
  try {
    const result = await processUserQuery(
      "请帮我查看 http://dzb.hxnews.com/news/yl/202411/28/2183049.shtml 网页的内容并总结一下"
    );
    console.log("处理结果:", result);
  } catch (error) {
    console.error("执行失败:", error);
  }
}

// 如果直接运行此文件
if (require.main === module) {
  main();
}

// 添加新的响应格式化函数
function formatStreamResponse(type, content) {
  return JSON.stringify({
    type,
    content
  }) + '\n'
}

// 修改现有的流式处理函数
async function handleStreamResponse(response, stream) {
  try {
    // 首先发送进度信息
    response.write(formatStreamResponse('progress', '正在处理您的请求...'))
    
    const decoder = new TextDecoder()
    for await (const chunk of stream) {
      const text = decoder.decode(chunk)
      // 发送实际的聊天内容
      response.write(formatStreamResponse('message', text))
    }
    
    response.write(formatStreamResponse('done', '处理完成'))
    response.end()
  } catch (error) {
    response.write(formatStreamResponse('error', error.message))
    response.end()
  }
}

module.exports = {
  processUserQuery,
  formatStreamResponse,
  handleStreamResponse
}

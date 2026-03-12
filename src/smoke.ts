import { buildApp } from "./index.js";

const app = buildApp();

const health = await app.inject({
  method: "GET",
  url: "/healthz"
});

console.log("healthz", health.statusCode, health.body);

const webhook = await app.inject({
  method: "POST",
  url: "/webhooks/feishu/events",
  payload: {
    header: {
      event_type: "im.message.receive_v1"
    },
    event: {
      sender: {
        sender_id: {
          user_id: "u_test"
        }
      },
      message: {
        message_id: "om_test",
        chat_id: "oc_test",
        message_type: "text",
        content: JSON.stringify({
          text: "/run pwd"
        })
      }
    }
  }
});

console.log("webhook", webhook.statusCode, webhook.body);

await app.close();

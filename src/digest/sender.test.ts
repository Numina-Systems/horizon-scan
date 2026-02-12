import { describe, it, expect, vi, beforeEach } from "vitest";

// Create mock client
const mockClient = {
  messages: {
    create: vi.fn(),
  },
};

// Mock mailgun.js module
vi.mock("mailgun.js", () => ({
  default: vi.fn(function (FormData: any) {
    return {
      client: vi.fn(() => mockClient),
    };
  }),
}));

// Import after mocking
import { createMailgunSender } from "./sender";

describe("createMailgunSender", () => {
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
    };
    mockClient.messages.create.mockReset();
  });

  it("should return success with messageId on successful send", async () => {
    mockClient.messages.create.mockResolvedValue({
      id: "msg-123",
    });

    const sendDigest = createMailgunSender("test-api-key", "example.com");

    const result = await sendDigest(
      "user@example.com",
      "Test Subject",
      "<html>Test</html>",
      mockLogger,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.messageId).toBe("msg-123");
    }

    expect(mockLogger.info).toHaveBeenCalledWith(
      { messageId: "msg-123", recipient: "user@example.com" },
      "digest email sent",
    );

    expect(mockClient.messages.create).toHaveBeenCalledWith("example.com", {
      from: "Horizon Scan <noreply@example.com>",
      to: ["user@example.com"],
      subject: "Test Subject",
      html: "<html>Test</html>",
    });
  });

  it("should return failure result without throwing on send error", async () => {
    const testError = new Error("Mailgun API error");
    mockClient.messages.create.mockRejectedValue(testError);

    const sendDigest = createMailgunSender("test-api-key", "example.com");

    const result = await sendDigest(
      "user@example.com",
      "Test Subject",
      "<html>Test</html>",
      mockLogger,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Mailgun API error");
    }

    expect(mockLogger.error).toHaveBeenCalledWith(
      { recipient: "user@example.com", error: "Mailgun API error" },
      "digest email send failed",
    );
  });

  it("should handle non-Error exceptions gracefully", async () => {
    mockClient.messages.create.mockRejectedValue("String error");

    const sendDigest = createMailgunSender("test-api-key", "example.com");

    const result = await sendDigest(
      "user@example.com",
      "Test Subject",
      "<html>Test</html>",
      mockLogger,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("String error");
    }
  });

  it("should handle missing messageId from response", async () => {
    mockClient.messages.create.mockResolvedValue({
      id: undefined,
    });

    const sendDigest = createMailgunSender("test-api-key", "example.com");

    const result = await sendDigest(
      "user@example.com",
      "Test Subject",
      "<html>Test</html>",
      mockLogger,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.messageId).toBe("unknown");
    }
  });
});

import { describe, expect, it, vi } from "vitest";
import { launchExternalService } from "./externalService";

const service = {
  name: "Prism",
  url: "https://prism.oshi.tw/",
  confirmationMessage: "要在瀏覽器開啟 Prism 嗎？",
};

describe("launchExternalService", () => {
  it("does not open the service when the user cancels", async () => {
    const confirm = vi.fn().mockResolvedValue(false);
    const open = vi.fn().mockResolvedValue(undefined);

    await expect(
      launchExternalService(service, { confirm, open }),
    ).resolves.toBe(false);
    expect(confirm).toHaveBeenCalledWith(
      service.name,
      service.confirmationMessage,
    );
    expect(open).not.toHaveBeenCalled();
  });

  it("opens the service after confirmation", async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    const open = vi.fn().mockResolvedValue(undefined);

    await expect(
      launchExternalService(service, { confirm, open }),
    ).resolves.toBe(true);
    expect(open).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith(service.url);
  });
});

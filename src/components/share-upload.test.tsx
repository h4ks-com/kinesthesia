import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ShareUpload } from "@/components/share-upload";

function offer(props: Partial<Parameters<typeof ShareUpload>[0]> = {}) {
  const onShare = vi.fn(async () => undefined);
  render(
    <ShareUpload
      name="mine.mid"
      onShare={onShare}
      sharedHref={null}
      signedIn={true}
      {...props}
    />,
  );
  return onShare;
}

describe("ShareUpload", () => {
  it("waits for the confirm before publishing anything", () => {
    const onShare = offer();
    fireEvent.click(screen.getByRole("button", { name: "Share mine.mid" }));
    expect(onShare).not.toHaveBeenCalled();
    expect(screen.getByText(/no taking it down/i)).toBeTruthy();
  });

  it("says the copy is permanent before it is made", () => {
    offer();
    fireEvent.click(screen.getByRole("button", { name: "Share mine.mid" }));
    const panel = screen.getByText(/anyone with the link can play it/i);
    expect(panel.textContent).toMatch(/no taking it down/i);
  });

  it("publishes on the confirm", async () => {
    const onShare = offer();
    fireEvent.click(screen.getByRole("button", { name: "Share mine.mid" }));
    fireEvent.click(screen.getByRole("button", { name: "share" }));
    await waitFor(() => expect(onShare).toHaveBeenCalledTimes(1));
  });

  it("keeps the panel open and says why when it does not go through", async () => {
    const onShare = vi.fn(async () => {
      throw new Error("That file is too large to share");
    });
    render(
      <ShareUpload
        name="mine.mid"
        onShare={onShare}
        sharedHref={null}
        signedIn={true}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Share mine.mid" }));
    fireEvent.click(screen.getByRole("button", { name: "share" }));
    await waitFor(() =>
      expect(screen.getByText("That file is too large to share")).toBeTruthy(),
    );
  });

  it("offers no way to publish when nobody is signed in", () => {
    const onShare = offer({ signedIn: false });
    const button = screen.getByRole("button", {
      name: "Sign in to share mine.mid",
    });
    fireEvent.click(button);
    expect(onShare).not.toHaveBeenCalled();
    expect(button.getAttribute("aria-disabled")).toBe("true");
  });

  it("hands out a whole address once the file is up", async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          written.push(text);
        },
      },
    });
    render(
      <ShareUpload
        name="mine.mid"
        onShare={null}
        sharedHref="/watch?url=https%3A%2F%2Ffiles.test%2Fa.mid"
        signedIn={true}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Copy the link to mine.mid" }),
    );
    await waitFor(() => expect(written).toHaveLength(1));
    expect(written[0]).toMatch(/^https?:\/\/[^/]+\/watch\?url=/);
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { ShareUpload } from "@/components/share-upload";

function offer(props: Partial<Parameters<typeof ShareUpload>[0]> = {}) {
  const onShare = vi.fn(async () => undefined);
  render(
    <ShareUpload
      name="mine.mid"
      onShare={onShare}
      sharedHref={null}
      signedIn={true}
      takeFocus={false}
      {...props}
    />,
  );
  return onShare;
}

describe("ShareUpload", () => {
  it("waits for the confirm before publishing anything", () => {
    const onShare = offer();
    fireEvent.click(
      screen.getByRole("button", { name: "Put mine.mid online" }),
    );
    expect(onShare).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog").textContent).toMatch(
      /cannot take it down/i,
    );
  });

  it("publishes on the confirm", async () => {
    const onShare = offer();
    fireEvent.click(
      screen.getByRole("button", { name: "Put mine.mid online" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "put it online" }));
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
        takeFocus={false}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Put mine.mid online" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "put it online" }));
    await waitFor(() =>
      expect(screen.getByText("That file is too large to share")).toBeTruthy(),
    );
  });

  it("offers no way to publish when nobody is signed in", () => {
    const onShare = offer({ signedIn: false });
    const button = screen.getByRole("button", {
      name: "Sign in to put mine.mid online",
    });
    fireEvent.click(button);
    expect(onShare).not.toHaveBeenCalled();
    expect(button.getAttribute("aria-disabled")).toBe("true");
  });

  it("takes the focus over from the confirm it replaces", () => {
    render(
      <ShareUpload
        name="mine.mid"
        onShare={null}
        sharedHref="/watch?url=a"
        signedIn={true}
        takeFocus
      />,
    );
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Copy the link to mine.mid" }),
    );
  });

  // A filter over the library mounts and unmounts these rows while somebody is
  // typing, so an arrival nobody asked for must leave the focus alone.
  it("leaves the focus where it is when it was not the one shared", () => {
    const typing = document.createElement("input");
    document.body.append(typing);
    onTestFinished(() => typing.remove());
    typing.focus();
    render(
      <ShareUpload
        name="mine.mid"
        onShare={null}
        sharedHref="/watch?url=a"
        signedIn={true}
        takeFocus={false}
      />,
    );
    expect(document.activeElement).toBe(typing);
  });

  it("hands out a whole address once the file is up", async () => {
    const written: string[] = [];
    const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          written.push(text);
        },
      },
    });
    onTestFinished(() => {
      if (original === undefined) {
        Reflect.deleteProperty(navigator, "clipboard");
      } else {
        Object.defineProperty(navigator, "clipboard", original);
      }
    });
    render(
      <ShareUpload
        name="mine.mid"
        onShare={null}
        sharedHref="/watch?url=https%3A%2F%2Ffiles.test%2Fa.mid"
        signedIn={true}
        takeFocus={false}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Copy the link to mine.mid" }),
    );
    await waitFor(() => expect(written).toHaveLength(1));
    expect(written[0]).toMatch(/^https?:\/\/[^/]+\/watch\?url=/);
  });
});

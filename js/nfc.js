/* ============================================================
   /nfc — Web NFC (NDEFReader) wrapper
   ------------------------------------------------------------
   Real NFC reading requires: Chrome for Android, a secure
   (HTTPS) context, and physical NFC hardware. It is NOT
   available on iOS Safari or desktop browsers — those always
   fall through to the controlled admin/testing fallback below,
   which is clearly labeled and never treated as equivalent to
   a real card tap in production (see spec section 42).
   ============================================================ */

const NfcModule = {
  isSupported() {
    return "NDEFReader" in window;
  },

  /**
   * Starts listening for an NFC tap.
   * onRead(serialNumberOrRecordText) is called once a tag is read.
   * onError(err) is called on failure/permission-denied.
   * Returns a stop() function.
   */
  async startScan(onRead, onError) {
    if (!this.isSupported()) {
      onError(new Error("NFC_UNSUPPORTED"));
      return () => {};
    }
    try {
      const reader = new NDEFReader();
      await reader.scan();
      const handleReading = ({ message, serialNumber }) => {
        // Prefer a text record if the card was written with one;
        // otherwise use the tag's hardware serial number as the identifier.
        let payload = serialNumber;
        try {
          for (const record of message.records) {
            if (record.recordType === "text") {
              const decoder = new TextDecoder(record.encoding || "utf-8");
              payload = decoder.decode(record.data);
              break;
            }
          }
        } catch (_) { /* fall back to serialNumber */ }
        onRead(payload);
      };
      reader.addEventListener("reading", handleReading);
      reader.addEventListener("readingerror", () => onError(new Error("NFC_READ_ERROR")));
      return () => reader.removeEventListener("reading", handleReading);
    } catch (err) {
      onError(err);
      return () => {};
    }
  },

  // Controlled fallback for admin/testing use only when Web NFC is
  // unavailable. Never wired into the production scan button silently —
  // the UI must show this is a manual/demo path, not a real card tap.
  simulateTap(nfcId, onRead) {
    setTimeout(() => onRead(nfcId), 900);
  },
};

window.NfcModule = NfcModule;

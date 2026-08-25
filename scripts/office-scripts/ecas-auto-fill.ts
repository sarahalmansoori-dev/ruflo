/**
 * ECAS Auto-Fill — v8.0
 *
 * An Excel Office Script, invoked by the Excel Online (Business) "Run script"
 * action in Power Automate. It is NOT part of the ruflo build: the root
 * tsconfig includes only the v3 TypeScript sources, and the ExcelScript types
 * this file needs exist only in the Office Scripts editor. Tracked here so the
 * flow's script has a reviewable history; edit in the Office Scripts editor
 * (OneDrive → Documents → Office Scripts) and mirror changes back.
 * ──────────────────────────────────────────────────────────────────────
 *
 * Fixes from v7 → v8:
 *   ✅ Line-183 crash — removed table1.resize(). Office Scripts queues
 *      writes and flushes them lazily, so the try/catch around resize()
 *      caught nothing and its failure surfaced at the next statement
 *      (setNumberFormat). Appending now uses table1.addRow(), which is
 *      the supported API and auto-fills calculated columns natively.
 *   ✅ Formula destruction — the overwrite path no longer writes a
 *      contiguous block seeded from getValues(). Only the three target
 *      cells are written, so #/quarter/age/priority formulas survive.
 *   ✅ Time now displays — the number format is applied once to the whole
 *      date COLUMN (a single cell's format loses to the column's).
 *      Applied after the write; format-after-write is not "overridden".
 *   ✅ Errors are now catchable — a read is issued after the writes to
 *      force the batch to flush inside the try block, so failures are
 *      reported with a real reason instead of a bare 403.
 *   ✅ Sheet protection handled and reported explicitly.
 *   ✅ Timezone no longer depends on the script host's local zone.
 *   ✅ Header matching normalizes alef + whitespace.
 *
 * PRESERVED from v7:
 *   ✔ Body-first parser with \s*:\s* whitespace-tolerant labels
 *   ✔ Hamza-normalized filter checks (تم اعتماد / للإدراج)
 *   ✔ Duplicate detection (reqNum, exact topic, normalized topic)
 *   ✔ UTC+4 correction, Excel UTC epoch serial
 *   ✔ Subject-based fallback for Format A short emails
 */
function main(
  workbook: ExcelScript.Workbook,
  emailSubject: string,
  emailFrom: string,
  emailBody: string,
  emailDate: string
): string {
  const GULF_OFFSET_HOURS = 4;
  const DATE_FORMAT = "dd/mm/yyyy h:mm AM/PM";

  function stripHtml(s: string): string {
    return s.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#\d+;/g, "")
            .replace(/\s+/g, " ").trim();
  }
  function normalizeAlef(s: string): string {
    return s.replace(/[إأآ]/g, "ا");
  }
  function normKey(s: string): string {
    return normalizeAlef(s).replace(/\s+/g, " ").trim();
  }
  function fail(reason: string, extra?: object): string {
    const out: object = Object.assign({ updated: false, reason: reason }, extra || {});
    return JSON.stringify(out);
  }

  const from = (emailFrom || "").toLowerCase();
  const body = stripHtml(emailBody || "");

  // ───────── FILTER CHECKS ─────────
  if (from.indexOf("ecasadmin") < 0) {
    return fail("Not from ecasadmin");
  }
  const subjectNorm = normalizeAlef(emailSubject || "");
  if (subjectNorm.indexOf("تم اعتماد") < 0) {
    return fail("Subject does not match تم اعتماد");
  }
  if ((subjectNorm + " " + normalizeAlef(body)).indexOf("للادراج") < 0) {
    return fail("للإدراج keyword not found");
  }

  // ───────── PARSE ─────────
  let topic = "";
  let committee = "";
  const subOrig = emailSubject || "";

  let reqNumMatch = body.match(/(RA-[A-Z]{2}-\d{4}-\d{4}-\d{2})/);
  if (!reqNumMatch) reqNumMatch = subOrig.match(/(RA-[A-Z]{2}-\d{4}-\d{4}-\d{2})/);
  const reqNum = reqNumMatch ? reqNumMatch[1] : "";

  const topicMatch = body.match(
    /الموضوع\s*:\s*([\s\S]+?)\s*(?:مقدم\s*من\s*:|اللجنة\s*:|يمكنك|$)/);
  if (topicMatch) topic = topicMatch[1].trim();

  const committeeMatch = body.match(
    /اللجنة\s*:\s*(لجنة[\s\S]+?)\s*(?:يمكنك|للاستفسار|$)/);
  if (committeeMatch) committee = committeeMatch[1].trim();

  if (!topic) {
    const markers = [
      "تم إعتماد الموضوع",
      "تم اعتماد الموضوع"
    ];
    for (let mi = 0; mi < markers.length; mi++) {
      const mIdx = subOrig.indexOf(markers[mi]);
      if (mIdx >= 0) {
        const tStart = mIdx + markers[mi].length;
        let tEnd = subOrig.indexOf("للإدراج", tStart);
        if (tEnd < 0) tEnd = subOrig.indexOf("للادراج", tStart);
        topic = (tEnd > tStart ? subOrig.substring(tStart, tEnd) : subOrig.substring(tStart)).trim();
        break;
      }
    }
  }

  topic = stripHtml(topic);
  committee = stripHtml(committee);
  if (topic.length > 200) topic = topic.substring(0, 197) + "...";
  if (!topic && !committee) {
    return fail("Could not extract topic or committee", { subject: subOrig.substring(0, 100) });
  }

  // ───────── DATE SERIAL (host-timezone independent) ─────────
  // Shift the true instant by the Gulf offset, then read it back with UTC
  // getters so the result never depends on the script host's local zone.
  const utcInstant = emailDate ? new Date(emailDate) : new Date();
  if (isNaN(utcInstant.getTime())) {
    return fail("Unparseable emailDate", { emailDate: emailDate });
  }
  const gulf = new Date(utcInstant.getTime() + GULF_OFFSET_HOURS * 3600000);
  const dateSerial = (gulf.getTime() - Date.UTC(1899, 11, 30)) / 86400000;

  const hh24 = gulf.getUTCHours();
  const hh12 = (hh24 % 12) === 0 ? 12 : (hh24 % 12);
  const dateStr =
    String(gulf.getUTCDate()).padStart(2, "0") + "/" +
    String(gulf.getUTCMonth() + 1).padStart(2, "0") + "/" +
    gulf.getUTCFullYear() + " " + hh12 + ":" +
    String(gulf.getUTCMinutes()).padStart(2, "0") + " " +
    (hh24 >= 12 ? "PM" : "AM");

  // ───────── LOCATE TABLE1 ─────────
  const table1 = workbook.getTable("Table1");
  if (!table1) {
    return fail("Table1 not found");
  }
  const sheet = table1.getWorksheet();

  const headerRaw = table1.getHeaderRowRange().getValues()[0];
  const headers = headerRaw.map((h) => normKey(String(h)));
  const iSubject = headers.indexOf(normKey("الموضوع"));
  const iDate = headers.indexOf(normKey("تاريخ إدراج البند"));
  const iCommittee = headers.indexOf(normKey("اللجنة المعنية"));
  if (iSubject < 0 || iDate < 0 || iCommittee < 0) {
    return fail("Required Table1 columns not found", {
      headersSeen: headers, iSubject: iSubject, iDate: iDate, iCommittee: iCommittee
    });
  }

  const allValues = table1.getRangeBetweenHeaderAndTotal().getValues();

  // ───────── DUPLICATE CHECK + FIRST EMPTY ROW ─────────
  const normTopic = normKey(topic);
  let insertIdx = -1;
  for (let r = 0; r < allValues.length; r++) {
    const rowSubj = String(allValues[r][iSubject]).trim();
    if (reqNum && rowSubj.indexOf(reqNum) >= 0) {
      return fail("Duplicate - request number already exists", { reqNum: reqNum });
    }
    if (topic !== "" && (rowSubj === topic || normKey(rowSubj) === normTopic)) {
      return fail("Duplicate - topic already exists", { topic: topic });
    }
    if (insertIdx < 0 && (rowSubj === "" || rowSubj === "-")) {
      insertIdx = r;
    }
  }
  const isAppend = (insertIdx < 0);

  // ───────── PROTECTION ─────────
  // A protected sheet rejects every write. Power Automate runs in its own
  // Excel session where protection is fully enforced, even if it appears
  // inactive when you run the script interactively.
  const prot = sheet.getProtection();
  const wasProtected = prot.getProtected();
  if (wasProtected) {
    try {
      prot.unprotect();
    } catch (e) {
      return fail("Worksheet is protected and could not be unprotected", {
        sheet: sheet.getName(),
        hint: "If protection has a password, pass it: prot.unprotect(\"<password>\")",
        error: String(e)
      });
    }
  }

  // ───────── WRITE ─────────
  let targetIdx = insertIdx;
  try {
    if (isAppend) {
      // addRow() is the supported append API. Called with no values, Excel
      // creates the row and auto-fills every calculated column (#, quarter,
      // age, priority) itself. Do NOT pass a values array here — supplying
      // values would overwrite those formulas with literals.
      table1.addRow(-1);
      targetIdx = allValues.length;
    }

    // Write ONLY the three target cells. Writing the whole minCol..maxCol
    // block (as v7 did) replaces the formulas in the in-between columns
    // with their frozen computed values.
    const bodyRange = table1.getRangeBetweenHeaderAndTotal();
    bodyRange.getCell(targetIdx, iSubject).setValue(topic);
    bodyRange.getCell(targetIdx, iDate).setValue(dateSerial);
    bodyRange.getCell(targetIdx, iCommittee).setValue(committee);

    // Format the whole date COLUMN, not one cell. A single cell's format
    // is easily lost to the column's own formatting; the column's is not.
    sheet.getRangeByIndexes(
      bodyRange.getRowIndex(),
      bodyRange.getColumnIndex() + iDate,
      bodyRange.getRowCount(),
      1
    ).setNumberFormat(DATE_FORMAT);

    // Force the queued batch to flush INSIDE this try block. Without a read
    // here, Office Scripts defers the writes and any failure escapes the
    // catch and is reported against a later, unrelated line.
    const verify = String(bodyRange.getCell(targetIdx, iSubject).getValue());
    console.log("[ecas] wrote row " + (targetIdx + 1) + ", subject cell reads: " + verify.substring(0, 60));
  } catch (e) {
    if (wasProtected) {
      prot.protect();
    }
    return fail("Write failed", {
      error: String(e),
      mode: isAppend ? "append" : "overwrite",
      targetIdx: targetIdx,
      sheet: sheet.getName(),
      sheetWasProtected: wasProtected
    });
  }

  // Restore protection. NOTE: if the sheet was password-protected, this
  // re-protects it WITHOUT the password. Pass the password to protect() to
  // preserve it, or leave the sheet unprotected and control access via
  // file permissions instead.
  if (wasProtected) {
    prot.protect();
  }

  return JSON.stringify({
    updated: true,
    topic: topic,
    committee: committee,
    reqNum: reqNum,
    date: dateStr,
    dateSerial: dateSerial,
    targetRow: targetIdx + 1,
    mode: isAppend ? "append" : "overwrite",
    sheetWasProtected: wasProtected
  });
}

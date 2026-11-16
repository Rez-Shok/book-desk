# Security

Book Desk opens files written by other people: PDFs and, above all, EPUBs, which are web pages inside a zip file.
It is built so that nothing in a book can run, fetch anything from the web, or reach outside the book's own pages,
and so that words copied from a book into a note stay plain text there. If you find a way around any of this,
please tell me privately.

## How to report

Use GitHub's private report: [Report a vulnerability](https://github.com/Rez-Shok/book-desk/security/advisories/new).
Please include the version, the device, and a small file that shows the problem (a book made for the purpose, not
one you may not share).

You will get an answer within a week. A fix is released as soon as it is ready, and the report is made public
with it, with credit to you if you wish.

## What counts

- A book (PDF or EPUB) that runs script, loads anything from the network, opens a page or app without a click on a
  plain web link, or changes anything outside the book's own pages.
- A book, a `.desk` file or a note that makes the plugin write something into a note that is not plain text.
- A `.desk` file that makes the plugin crash, hang, or touch files other than its own and the book's note.

The plugin itself never connects to the network and has no account or telemetry.

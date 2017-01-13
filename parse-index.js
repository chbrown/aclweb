const {parse} = require('url');
const jsdom = require('jsdom');

// interface WebFile {
//   /** Absolute URL pointing to resource. */
//   url: string;
//   filename: string;
// }
//
// interface Conference {
//   id: string;
//   name: string;
//   description: string;
//   volumes: string[];
// }
//
// interface Entry {
//   /** Conference volume, e.g., 'P/P95' */
//   volume: string;
//   /** Section/Track, e.g., '33rd Annual Meeting of the Association for Computational Linguistics' */
//   section: string;
//   /** Attributed authors, e.g., 'Kevin Knight; Vasileios Hatzivassiloglou' */
//   author: string;
//   /** Paper title, e.g., 'Two-Level, Many-Paths Generation' */
//   title: string;
//   pdf: WebFile;
//   bib: WebFile;
// }

function createWebFile(url, filename) {
  if (filename === undefined) {
    const urlObj = parse(url);
    const pathComponents = urlObj.pathname.split('/');
    filename = pathComponents[pathComponents.length - 1];
  }
  return {url, filename};
}

const volume = process.argv[2];
const url = `https://www.aclweb.org/anthology/${volume}/`;

/**
Parse the HTML of an ACL Anthology index page from STDIN and serialize an array
of Entry objects to STDOUT
*/
jsdom.env({
  file: '/dev/stdin',
  url,
  done(error, window) {
    if (error) throw error;
    const document = window.document;
    const content = document.getElementById('content') || document.getElementsByTagName('body')[0];

    if (content === undefined) {
      throw new Error('No #content element could be found');
    }

    let section = null;
    const entries = [];
    // jsdom bug: [...content.children] // TypeError: content.children[Symbol.iterator] is not a function
    // [...content.childNodes].filter(childNode => childNode.nodeType === document.ELEMENT_NODE)
    Array.from(content.children).forEach(child => {
      if (child.tagName === 'H1') {
        section = child.textContent;
      }
      else if (section !== null) {
        const pdf_anchor = child.querySelector('a[href$="pdf"]');
        const bib_anchor = child.querySelector('a[href$="bib"]');
        const b = child.querySelector('b');
        const i = child.querySelector('i');
        const author = (b ? b.textContent : 'NA').replace(/\s+/g, ' ').trim();
        const title = (i ? i.textContent : 'NA').replace(/\s+/g, ' ').trim();
        const pdf = pdf_anchor ? createWebFile(pdf_anchor.href, pdf_anchor.textContent + '.pdf') : null;
        const bib = bib_anchor ? createWebFile(bib_anchor.href) : null;
        entries.push({volume, section, author, title, pdf, bib});
      }
    });
    console.log(JSON.stringify(entries, null, '  '));
  },
});

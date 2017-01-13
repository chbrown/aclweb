import * as fs from 'fs';
import {join, dirname} from 'path';
import {parse} from 'url';
import * as optimist from 'optimist';
import * as jsdom from 'jsdom';
import * as async from 'async';
import * as mkdirp from 'mkdirp';
import * as js_yaml from 'js-yaml';
import {flatMap, flatten} from 'tarry';
import * as request from 'request';
import {logger, Level} from 'loge';

/**
If no file exists at 'filepath', call 'createFunction(callback)'.
*/
function ensureFile(filepath: string,
                    createFunction: (callback: (error?: Error) => void) => void,
                    callback: (error?: Error) => void): void {
  fs.exists(filepath, exists => {
    if (exists) {
      callback();
    }
    else {
      createFunction(callback);
    }
  });
}

/**
Streams 'url' into 'filepath', whether or not 'filepath' exists.
*/
function download({url, filepath}: {url: string, filepath: string},
                  callback: (error?: Error) => void): void {
  mkdirp(dirname(filepath), (error: Error) => {
    if (error) return callback(error);
    logger.info(`GET ${url} (${filepath})`);
    const req = request.get(url);
    req.on('error', (error) => {
      logger.error(`request error ${url}`);
      callback(error);
    });
    req.on('response', (res) => {
      if (res.statusCode != 200) {
        logger.warning(`HTTP response != 200`);
        return callback(new Error('HTTP response != 200'));
      }
      logger.info(`download ${url} > ${filepath}`);
      const stream = fs.createWriteStream(filepath);
      res.pipe(stream).on('finish', callback);
    });
  });
}

/**
If 'filepath' does not exist, streams 'url' into 'filepath'.
Then reads the file from 'filepath' as a string with UTF-8 encoding.
*/
function readOrDownload({url, filepath}: {url: string, filepath: string},
                        callback: (error?: Error, data?: string) => void): void {
  ensureFile(filepath, callback => download({url, filepath}, callback), error => {
    if (error) return callback(error);
    logger.debug(`read ${filepath}`);
    fs.readFile(filepath, {encoding: 'utf8'}, callback);
  });
}

const ANTHOLOGY = process.env.ANTHOLOGY; // '~/corpora-public/acl-anthology'

interface WebFile {
  /** Absolute URL pointing to resource. */
  url: string;
  filename: string;
}

interface Conference {
  id: string;
  name: string;
  description: string;
  volumes: string[];
}

interface Entry {
  /** Conference volume, e.g., 'P/P95' */
  volume: string;
  /** Section/Track, e.g., '33rd Annual Meeting of the Association for Computational Linguistics' */
  section: string;
  /** Attributed authors, e.g., 'Kevin Knight; Vasileios Hatzivassiloglou' */
  author: string;
  /** Paper title, e.g., 'Two-Level, Many-Paths Generation' */
  title: string;
  pdf: WebFile;
  bib: WebFile;
}

/**
Parse the HTML of an ACL Anthology index page and serialize an array of Entry
objects to the specified file.
*/
function downloadEntries(volume: string,
                         index_json_filepath: string,
                         callback: (error?: Error) => void) {
  function createWebFile(url, filename?) {
    if (filename === undefined) {
      const urlObj = parse(url);
      const pathComponents = urlObj.pathname.split('/');
      filename = pathComponents[pathComponents.length - 1];
    }
    return {url, filename};
  }
  const index = {
    url: `https://www.aclweb.org/anthology/${volume}/`,
    filepath: join(ANTHOLOGY, volume, 'index.html')
  };
  // Fetch ACL page (potentially from cache) and parse list of entries
  readOrDownload(index, (error, html) => {
    if (error) return callback(error);
    jsdom.env({
      html,
      url: index.url,
      done(error, window) {
        if (error) return callback(error as any);
        const document = window.document;
        const content = document.getElementById('content') || document.getElementsByTagName('body')[0];

        if (content === undefined) {
          return callback(new Error('No #content element could be found'));
        }

        let section: string = null;
        const entries: Entry[] = [];
        // jsdom bug: [...content.children] // TypeError: content.children[Symbol.iterator] is not a function
        // [...content.childNodes].filter(childNode => childNode.nodeType === document.ELEMENT_NODE)
        Array.from(content.children).forEach(child => {
          if (child.tagName === 'H1') {
            section = child.textContent;
          }
          else if (section !== null) {
            const pdf_anchor = child.querySelector('a[href$="pdf"]') as HTMLAnchorElement;
            const bib_anchor = child.querySelector('a[href$="bib"]') as HTMLAnchorElement;
            const b = child.querySelector('b');
            const i = child.querySelector('i');
            const author = b ? b.textContent : 'NA';
            const title = i ? i.textContent : 'NA';
            const pdf = pdf_anchor ? createWebFile(pdf_anchor.href, pdf_anchor.textContent + '.pdf') : null;
            const bib = bib_anchor ? createWebFile(bib_anchor.href) : null;
            entries.push({volume, section, author, title, pdf, bib});
          }
        });

        const data = JSON.stringify(entries, null, '  ') + '\n';
        logger.info(`write ${index_json_filepath} (${entries.length} entries, ${data.length} characters)`);
        fs.writeFile(index_json_filepath, data, {encoding: 'utf8'}, callback);
      },
    });
  });
}

function readOrGetEntries(volume: string, callback: (error?: Error, entries?: Entry[]) => void) {
  const index_json_filepath = join(ANTHOLOGY, volume, 'index.html.json');
  ensureFile(index_json_filepath, callback => downloadEntries(volume, index_json_filepath, callback), error => {
    if (error) return callback(error);
    logger.debug(`read ${index_json_filepath}`);
    fs.readFile(index_json_filepath, {encoding: 'utf8'}, (error, data) => {
      if (error) return callback(error);
      const entries = JSON.parse(data);
      callback(null, entries);
    });
  });
}

function loadEntries(conferences_yaml_filepath: string,
                     callback: (error?: Error, entries?: Entry[]) => void) {
  logger.debug(`read ${conferences_yaml_filepath}`);
  const conferences_yaml = fs.readFileSync(conferences_yaml_filepath, {encoding: 'utf8'});
  const conferences: Conference[] = js_yaml.load(conferences_yaml);
  const volumes = flatMap(conferences, conference => conference.volumes);
  // volumes is something like ['P/P90', 'P/P91', ...]
  logger.info(`Found ${volumes.length} volumes`);
  // oddly, a flat out map with no limit breaks here (bug with # of open files?), so we impose a limit
  async.mapLimit(volumes, 10, readOrGetEntries, (error, volumesEntries) => {
    if (error) return callback(error);
    // flatten out over conferences/years
    const entries = flatten(volumesEntries);
    callback(null, entries);
  });
}

function ensureEntries(entries: Entry[], callback: (error?: Error) => void) {
  const files = flatMap(entries, ({volume, bib, pdf}) => {
    return [
      ...(bib ? [{
        url: bib.url,
        filepath: join(ANTHOLOGY, volume, bib.filename),
      }] : []),
      ...(pdf ? [{
        url: pdf.url,
        filepath: join(ANTHOLOGY, volume, pdf.filename),
      }] : []),
    ];
  });
  logger.info(`Found ${files.length} files`);
  // check for file existence first, since we want to be less parallel when downloading files
  async.mapLimit(files, 10, ({url, filepath},
    callback: (error?: Error, file?: {url: string, filepath: string, exists: boolean}) => void) => {
    fs.exists(filepath, exists => callback(null, {url, filepath, exists}))
  }, (error, files) => {
    if (error) return callback(error);
    const missingFiles = files.filter(({exists}) => !exists);
    logger.info(`Downloading ${missingFiles.length} missing files`);
    const errors: Error[] = [];
    async.eachLimit(missingFiles, 2, (file, callback) => {
      download(file, error => {
        if (error) {
          errors.push(error);
        }
        callback();
      });
    }, error => {
      if (errors.length > 0) {
        const errorsString = errors.map(error => error.toString()).join(', ');
        return callback(new Error(errorsString));
      }
      callback();
    });
  });
}

function processEntries(entries: Entry[], callback: (error?: Error) => void) {
  // exclude entries with no PDF url
  const pdfEntries = entries.filter(entry => entry.pdf !== null);
  logger.info(`Processing ${pdfEntries.length} entries (converting PDFs to TXT)`);

  async.eachLimit(entries, 1, (entry, callback) => {
    const pdf_filepath = join(ANTHOLOGY, entry.volume, entry.pdf.filename);
    const txt_filepath = pdf_filepath.replace(/.pdf$/, '.txt');

    ensureFile(txt_filepath, (callback: (error?: Error) => void) => {
      callback();
    }, (err) => {
      if (err) {
        logger.error('text.extract raised %s; ignoring', err.toString());
      }
      callback();
    });
  }, callback);
}

function main() {
  if (ANTHOLOGY === undefined) {
    throw new Error('You must set the "ANTHOLOGY" environment variable');
  }
  // const argv = optimist.describe({url: 'The base URL of the page'}).argv;
  logger.level = Level.debug;
  const conferences_yaml_filepath = join(__dirname, 'conferences.yaml');
  loadEntries(conferences_yaml_filepath, (error, entries) => {
    if (error) throw error;
    logger.info(`Found ${entries.length} entries`);
    // entries.forEach(entry => {
    //   console.log(JSON.stringify(entry));
    // });
    ensureEntries(entries, (error) => {
      if (error) throw error;

      logger.info('DONE');
    });
  });
}

if (require.main === module) main();

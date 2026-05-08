const slugify = require('slugify');

function makeSlug(text, suffix = '') {
  const base = slugify(text, { lower: true, strict: true, trim: true });
  return suffix ? `${base}-${suffix}` : base;
}

function paginate(total, page, perPage) {
  const totalPages = Math.ceil(total / perPage);
  return {
    total,
    page: parseInt(page),
    perPage,
    totalPages,
    hasPrev: page > 1,
    hasNext: page < totalPages,
    offset: (page - 1) * perPage,
  };
}

function timeAgo(date) {
  const moment = require('moment');
  return moment(date).fromNow();
}

function formatDate(date, fmt = 'MMM D, YYYY') {
  const moment = require('moment');
  return moment(date).format(fmt);
}

function truncate(str, len = 150) {
  if (!str) return '';
  return str.length > len ? str.substring(0, len) + '...' : str;
}

function stripHtml(html) {
  return html ? html.replace(/<[^>]*>/g, '') : '';
}

module.exports = { makeSlug, paginate, timeAgo, formatDate, truncate, stripHtml };

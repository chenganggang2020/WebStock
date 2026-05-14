(function() {
  const TIME_ZONE = 'Asia/Shanghai';

  function parts(date) {
    const items = new Intl.DateTimeFormat('en-CA', {
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).formatToParts(date instanceof Date ? date : new Date(date));
    return items.reduce(function(acc, item) {
      if (item.type !== 'literal') acc[item.type] = item.value;
      return acc;
    }, {});
  }

  function todayDate() {
    const p = parts(new Date());
    return p.year + '-' + p.month + '-' + p.day;
  }

  function formatDate(value) {
    if (!value) return '--';
    const raw = String(value);
    const rawDate = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    if (rawDate) return rawDate[1];
    const p = parts(value);
    return p.year + '-' + p.month + '-' + p.day;
  }

  function formatDateTime(value) {
    if (!value) return '--';
    const raw = String(value);
    const rawDateTime = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
    if (rawDateTime && !/(Z|[+-]\d{2}:?\d{2})$/i.test(raw)) return rawDateTime[1] + ' ' + rawDateTime[2] + ' 北京时间';
    const p = parts(value);
    return p.year + '-' + p.month + '-' + p.day + ' ' + p.hour + ':' + p.minute + ':' + p.second + ' 北京时间';
  }

  function filenameDate() {
    return todayDate();
  }

  function currentMinutes() {
    const p = parts(new Date());
    return Number(p.hour) * 60 + Number(p.minute);
  }

  window.WebStockTime = {
    timeZone: TIME_ZONE,
    todayDate,
    formatDate,
    formatDateTime,
    filenameDate,
    currentMinutes
  };
})();

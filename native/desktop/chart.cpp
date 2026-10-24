#include "chart.hpp"
#include "vwap_chart_input.hpp"
#include "chart_annotations_input.hpp"
#include "display_indicators.hpp"
#include "appearance.hpp"
#include <QComboBox>
#include <QLabel>
#include <QPushButton>
#include <QVBoxLayout>
#include <QSignalBlocker>
#include <QResizeEvent>
#include <QHideEvent>
#include <QShowEvent>

#include <QDateTime>
#include <QKeyEvent>
#include <QMouseEvent>
#include <QPainter>
#include <QPainterPath>
#include <QWheelEvent>
Chart::Chart(QWidget *p) : QWidget(p) {
  connect(this,&Chart::barSelected,this,[this](int i){refreshAnnotations(i);});
  setMinimumSize(260, 260);
  setMouseTracking(true);
  setFocusPolicy(Qt::StrongFocus);
  setAccessibleName("行情图表：滚轮缩放，拖动历史，单击读取，Home回最新");
  indicatorControl=new QComboBox(this);
  indicatorControl->setObjectName("chartIndicatorSelector");
  indicatorControl->setAccessibleName("副图指标");
  indicatorControl->addItems({"MACD","ATR","RVOL","KDJ","RSI","CCI","OBV"});
  connect(indicatorControl,&QComboBox::currentTextChanged,this,[this](const QString& name){
    indicator=name;recalculate();emit indicatorChanged(name);
  });
  auto* emptyState=new QWidget(this);
  emptyState->setObjectName("chartEmptyState");
  emptyState->setStyleSheet("#chartEmptyState,#chartEmptyState QLabel,#chartEmptyActions{background:transparent;}");
  auto* emptyLayout=new QVBoxLayout(emptyState);
  emptyLayout->addStretch();
  auto* emptyMessage=new QLabel("该周期暂无数据",emptyState);
  emptyMessage->setObjectName("chartEmptyMessage");
  emptyMessage->setTextFormat(Qt::PlainText);
  emptyMessage->setAlignment(Qt::AlignCenter);
  emptyMessage->setWordWrap(true);
  emptyLayout->addWidget(emptyMessage);
  auto* emptyActions=new QWidget(emptyState);
  emptyActions->setObjectName("chartEmptyActions");
  auto* actions=new QHBoxLayout(emptyActions);
  actions->setContentsMargins(0,8,0,0);
  actions->addStretch();
  auto* minuteButton=new QPushButton("显示1分钟分时",emptyActions);
  minuteButton->setObjectName("chartEmptyMinute");
  actions->addWidget(minuteButton);
  auto* historyButton=new QPushButton("查看秒级历史",emptyActions);
  historyButton->setObjectName("chartEmptySecondsHistory");
  actions->addWidget(historyButton);
  actions->addStretch();
  emptyLayout->addWidget(emptyActions);
  emptyLayout->addStretch();
  emptyActions->hide();
  placeIndicatorControl();
}
void Chart::setSeries(std::vector<market::Bar> data, QStringList dates,
                      bool isMinute, bool reset) {
  extensionLayers.clear();
  const bool firstData = bars.empty();
  const bool followEnd = firstData || endIndex >= int(bars.size());
  int oldLatest = int(bars.size()) - 1;
  while (oldLatest >= 0 && !market::valid(bars[oldLatest])) --oldLatest;
  const bool followSelection = bars.empty() || selected == oldLatest;
  const double selectedTime =
      selected >= 0 && selected < int(bars.size()) ? bars[selected].time : NAN;
  const double endTime = endIndex > 0 && endIndex <= int(bars.size())
                             ? bars[endIndex - 1].time
                             : NAN;
  const double pressedEndTime = dragging && startEnd > 0 && startEnd <= int(bars.size())
                                    ? bars[startEnd - 1].time
                                    : NAN;
  const bool modeChanged = minute != isMinute;
  bars = std::move(data);
  labels = dates;
  minute = isMinute;
  setAccessibleName(minute
                        ? (annotationMeta.value("legacyHistorical").toBool()?"旧历史桶尾：09:15集合竞价与原交易时段，缺口保留":"当日分时：固定全天时间轴，拖动读取，Home回最新")
                        : "行情图表：滚轮缩放，拖动历史，单击读取，Home回最新");
  auto indexAt = [this](double time, bool exact = false) {
    auto it = std::lower_bound(
        bars.begin(), bars.end(), time,
        [](const market::Bar &b, double t) { return b.time < t; });
    if (exact && (!std::isfinite(time) || it == bars.end() || it->time != time))
      return -1;
    return bars.empty()
               ? -1
               : std::min(int(bars.size()) - 1, int(it - bars.begin()));
  };
  if (reset || followEnd)
    endIndex = int(bars.size());
  else
    endIndex = indexAt(endTime) + 1;
  if (reset || firstData)
    visibleCount = minute ? std::max(1, int(bars.size())) : 96;
  if (minute) {
    visibleCount = std::max(1, int(bars.size()));
    endIndex = int(bars.size());
  }
  const int restoredSelection = indexAt(selectedTime, true);
  if (reset || firstData || (followSelection && (oldLatest < 0 || restoredSelection >= 0))) {
    selected = int(bars.size()) - 1;
    while (selected >= 0 && !market::valid(bars[selected])) --selected;
  } else
    selected = restoredSelection;
  if (dragging) {
    // Keep the pressed time across inserts/removals, rather than its old row.
    const int pressedIndex = indexAt(pressedEndTime, true);
    if (reset || modeChanged || pressedIndex < 0)
      dragging = false;
    else
      startEnd = pressedIndex + 1;
  }
  if (reset || modeChanged || bars.empty() || !dragging) lastInspectX = NAN;
  recalculate();
}
void Chart::recalculate() {
  overlayData = market::ema(bars, emaPeriod);
  maData.clear();
  for (auto n : maPeriods)
    maData.push_back(maType == "EMA" ? market::ema(bars, n)
                                     : market::sma(bars, n));
  auto m = displayIndicators::macd(bars, macdFast, macdSlow, macdSignal, displayMacdRun);
  dif = m.dif;
  dea = m.dea;
  kdjData = {};
  if (indicator == "KDJ") {
    kdjData = market::legacyChartKdj(bars, kdjPeriod);
    subData = kdjData.k;
  } else if (indicator == "RSI") subData = market::legacyChartRsi(bars, rsiPeriod);
  else if (indicator == "CCI") subData = market::legacyChartCci(bars, cciPeriod);
  else if (indicator == "OBV") subData = market::legacyChartObv(bars);
  else subData = indicator == "ATR" ? market::atr(bars, atrPeriod)
                  : indicator == "RVOL" ? market::rvol(bars, volumePeriod) : m.hist;
  vwapData = {}; vwapError.clear();
  try {
    if (vwapRows.size() != int(bars.size())) throw std::runtime_error("VWAP源记录与主图未对齐");
    for (size_t i=0;i<bars.size();++i)
      if (vwapChartInput::number(vwapRows[int(i)].toObject(),"time") != bars[i].time)
        throw std::runtime_error("VWAP源时点与主图未对齐");
    vwapData = vwapChartInput::calculate(vwapRows,vwapMeta,vwapPeriod,vwapMode,vwapAnchor);
  } catch (const std::exception& e) { vwapError = QString::fromUtf8(e.what()); }
  seq = market::sequential(bars);
  {QSignalBlocker blocker(indicatorControl);indicatorControl->setCurrentText(indicator);}
  indicatorControl->setToolTip(indicatorTitle()+"\n"+indicatorValues(selected)+
    (indicator=="MACD"?"\n沿用旧图表首价递推；不改变策略及回测公式。":""));
  placeIndicatorControl();
  refreshAnnotations();
  update();
}
QString Chart::vwapText(int index) const {
  if (!vwapEnabled) return "VWAP已关闭";
  if (!vwapError.isEmpty()) return "VWAP不可用：" + vwapError;
  return QString::fromStdString(vwap::explain(vwapData,index));
}
QString Chart::indicatorTitle() const {
  if (indicator == "KDJ") return QString("KDJ %1,3,3").arg(kdjPeriod);
  if (indicator == "RSI") return QString("RSI %1 · 简单滚动").arg(rsiPeriod);
  if (indicator == "CCI") return QString("CCI %1").arg(cciPeriod);
  if (indicator == "OBV") return "OBV · 全载入历史累计";
  if (indicator == "MACD") return QString("MACD %1,%2,%3 · 柱×2").arg(macdFast).arg(macdSlow).arg(macdSignal);
  return indicator + " " + QString::number(indicator == "ATR" ? atrPeriod : volumePeriod);
}
QString Chart::changeText(int index) const {
  const double base = minute ? previousClose
      : index > 0 && index < int(bars.size()) && market::valid(bars[index-1])
          ? bars[index-1].close : NAN;
  const QString basis = minute ? "（较昨收）" : "（较前一根收盘）";
  if (index < 0 || index >= int(bars.size()) || !market::valid(bars[index]) ||
      !std::isfinite(base) || base <= 0)
    return "涨跌幅 未取得" + basis;
  const double pct = (bars[index].close / base - 1) * 100;
  return "涨跌幅 " + (pct > 0 ? QString("+") : QString()) +
      QString::number(pct, 'f', 2) + "%" + basis;
}
QString Chart::indicatorValues(int index) const {
  if (index < 0 || index >= int(bars.size())) return "请选择时点";
  const auto value = [index](const std::vector<double> &data) {
    return index < int(data.size()) && std::isfinite(data[index])
        ? QString::number(data[index], 'f', 2) : QString("—");
  };
  QString text;
  if (indicator == "KDJ") {
    text = "K " + value(kdjData.k) + "  D " + value(kdjData.d) + "  J " + value(kdjData.j);
    if (index < int(kdjData.k.size()) && std::isfinite(kdjData.k[index])
        && !kdjData.ready[index]) text += QString(" · 初始化 / 未满%1根").arg(kdjPeriod);
  } else if (indicator == "MACD") {
    text = "DIF " + value(dif) + "  DEA " + value(dea) + "  柱 " + value(subData);
    if(index<int(displayMacdRun.size())&&displayMacdRun[index]>0&&displayMacdRun[index]<macdSlow+macdSignal-1)text+=" · 初始化";
  }
  else text = indicator + " " + value(subData);
  if (!market::valid(bars[index])) text += " · 数据缺口";
  else if (index >= int(subData.size()) || !std::isfinite(subData[index])) text += " · 指标预热 / 连续数据不足";
  if (!bars[index].closed) text += " · 形成中，非确认信号";
  return text;
}
void Chart::latest() {
  dragging = false;
  lastInspectX = NAN;
  endIndex = int(bars.size());
  if (minute) visibleCount = std::max(1, endIndex);
  selected = endIndex - 1;
  while (selected >= 0 && !market::valid(bars[selected])) --selected;
  update();
  emit barSelected(selected);
}
int Chart::axisWidth()const {
  // Reserve a signed price budget using font/DPI only, never current data.
  return std::clamp(QFontMetrics(QFont("Consolas",9),this).horizontalAdvance("-000.00")+10,60,90);
}
QRectF Chart::priceRect() const {
  const int left=axisWidth();
  return QRectF(left,30,std::max(1,width()-left-12),std::max(60.,(height()-104)*.66));
}
QRectF Chart::volumeRect() const {
  auto price = priceRect();
  return QRectF(price.left(), price.bottom() + 16, price.width(),
                std::max(20., (height() - 104) * .13));
}
QRectF Chart::indicatorRect() const {
  auto volume = volumeRect();
  const double top = volume.bottom() + 30;
  return QRectF(volume.left(), top, volume.width(),
                std::max(16., height() - top - 30));
}
void Chart::placeIndicatorControl(){
  const bool hasData=std::any_of(bars.begin(),bars.end(),[](const market::Bar& b){return market::valid(b);});
  if(indicatorControl){indicatorControl->show();indicatorControl->setGeometry(int(indicatorRect().left()),int(volumeRect().bottom()+3),94,26);}
  if(auto* emptyState=findChild<QWidget*>("chartEmptyState")){emptyState->setVisible(!hasData);emptyState->setGeometry(priceRect().toRect());}
}
void Chart::resizeEvent(QResizeEvent* event){QWidget::resizeEvent(event);placeIndicatorControl();}
double Chart::barX(int i) const {
  if (bars.empty()) return priceRect().left();
  const auto r = priceRect();
  if(minute&&annotationMeta.value("legacyHistorical").toBool()){auto clock=QDateTime::fromMSecsSinceEpoch(qint64(bars[i].time),Qt::UTC).addSecs(8*3600).time();double m=clock.hour()*60+clock.minute()+clock.second()/60.;double elapsed=m<=565?std::clamp(m-555.,0.,10.):m<=690?10.+std::max(0.,m-570.):130.+std::max(0.,m-780.);return r.left()+std::clamp(elapsed,0.,250.)/250.*r.width();}
  const auto firstClock =
      QDateTime::fromMSecsSinceEpoch(qint64(bars.front().time), Qt::UTC)
          .addSecs(8 * 3600)
          .time();
  if (minute && firstClock.hour() == 9 && firstClock.minute() == 30) {
    const auto clock =
        QDateTime::fromMSecsSinceEpoch(qint64(bars[i].time), Qt::UTC)
            .addSecs(8 * 3600)
            .time();
    const double m = clock.hour() * 60 + clock.minute() + clock.second() / 60.;
    if (m >= 570 && m <= 900)
      return r.left() + std::clamp(m <= 690 ? m - 570 : m - 660, 0., 240.) /
                            240 * r.width();
  }
  const int end = std::clamp(endIndex, 1, int(bars.size())),
            start = std::max(0, end - visibleCount);
  return r.left() + (i - start + .5) * r.width() / std::max(1, end - start);
}
void Chart::paintEvent(QPaintEvent *) {
  QPainter p(this);
  p.setRenderHint(QPainter::Antialiasing);
  const auto theme=appearance::theme(window()->property("stockTheme").toString().isEmpty()?(dark?"navy":"soft"):window()->property("stockTheme").toString());
  QColor bg=theme.bg,text=theme.text,muted=theme.muted,grid=theme.grid,up=theme.up,down=theme.down;
  if(!theme.preset)grid.setAlpha(100);
  p.fillRect(rect(), bg);
  p.setFont(QFont("Microsoft YaHei UI", 9));
  p.setPen(text);
  // The canvas exists before prices arrive and remains present for real gaps.
  const auto reserved=priceRect();p.setPen(grid);
  for(int j=0;j<5;++j){auto y=reserved.top()+j*reserved.height()/4;p.drawLine(QPointF(reserved.left(),y),QPointF(reserved.right(),y));}
  p.drawRect(volumeRect());p.drawRect(indicatorRect());p.setPen(text);
  if (bars.empty()) {
    return;
  }
  int end = std::clamp(endIndex, 1, int(bars.size())),
      start = std::max(0, end - visibleCount), n = end - start;
  auto r = priceRect();
  double step = r.width() / n;
  const auto bounds=priceBounds(start,end);double lo=bounds.first,hi=bounds.second;
  if (!std::isfinite(lo)) {
    return;
  }
  auto x = [&](int i) { return barX(i); };
  auto y = [&](double v) {
    return r.bottom() - (v - lo) / (hi - lo) * r.height();
  };
  if(theme.preset){
    p.setPen(QPen(grid,1));
    for(int j=1;j<4;++j){double yy=r.top()+j*r.height()/4;p.drawLine(QPointF(r.left(),yy),QPointF(r.right(),yy));}
    if(theme.hollowUp)for(int j=1;j<6;++j){double xx=r.left()+j*r.width()/6;p.drawLine(QPointF(xx,r.top()),QPointF(xx,r.bottom()));}
  }
  p.setPen(muted);
  p.drawText(
      QRectF(2, 2, width() - 4, 25), Qt::AlignVCenter,
      periodName + "  ·  " + (annotationsEnabled?QString("关键位按选中根重建 · "):QString()) +
          (minute ? (annotationMeta.value("legacyHistorical").toBool()?"原时段 09:15–09:25 / 09:30–11:30 / 13:00–15:00":"全天固定 09:30–15:00 · 拖动读取") : maType + " " + [&] {
            QStringList ns;
            for (auto n : maPeriods) ns << QString::number(n);
            return ns.join("/");
          }() + " · 九转 1–9 / C1–C13"));
  p.setFont(QFont("Consolas", 9));
  for (int j = 0; j < 5; ++j) {
    double yy = r.top() + j * r.height() / 4;
    p.setPen(muted);
    const auto number=hi-(hi-lo)*j/4;auto tick=QString::number(number,'f',priceDecimals);
    for(int precision=8;precision>0&&p.fontMetrics().horizontalAdvance(tick)>axisWidth()-9;--precision)tick=QString::number(number,'g',precision);
    p.drawText(QRectF(1, yy - 9, axisWidth() - 8, 18), Qt::AlignRight,tick);
  }
  p.save();
  p.setClipRect(r.adjusted(0, -22, 0, 30));
  QPainterPath pricePath, emaPath;
  QList<QRectF> marks;
  auto mark = [&](const QString &text, double xx, double desiredY,
                  const QColor &color) {
    p.setFont(QFont("Consolas", 8));
    double w = p.fontMetrics().horizontalAdvance(text),
           h = p.fontMetrics().height();
    double px = std::clamp(xx - w / 2, r.left() + 1, r.right() - w - 1);
    double anchor = std::clamp(desiredY, r.top() + h, r.bottom() - 2),
           baseline = anchor;
    QRectF box;
    for (int attempt = 0; attempt < 35; ++attempt) {
      double delta = attempt == 0
                         ? 0
                         : ((attempt + 1) / 2) * (attempt % 2 ? -h - 2 : h + 2);
      baseline = std::clamp(anchor + delta, r.top() + h, r.bottom() - 2);
      box = QRectF(px - 1, baseline - h, w + 2, h + 2);
      bool overlap = false;
      for (const auto &previous : marks)
        if (previous.intersects(box)) {
          overlap = true;
          break;
        }
      if (!overlap) break;
    }
    marks.append(box);
    if (std::abs(baseline - anchor) > 28) {
      p.setPen(QPen(grid, .7));
      p.drawLine(QPointF(xx, anchor), QPointF(px + w / 2, baseline - h / 2));
    }
    p.setPen(color);
    p.drawText(QPointF(px, baseline), text);
  };
  bool connected = false, emaConnected = false;
  for (int i = start; i < end; ++i) {
    auto &b = bars[i];
    if (!market::valid(b)) {
      connected = emaConnected = false;
      // Blank slots stay blank; the crosshair reports missing data without
      // filling the unelapsed part of the session with repeated labels.
      continue;
    }
    QColor color = b.close >= b.open ? up : down;
    double xx = x(i);
    p.setPen(QPen(color, theme.id=="clear"?1.4:1));
    if (minute) {
      bool lunch = i > start && std::abs(barX(i) - barX(i - 1)) < 1e-8;
      if (lunch) {
        p.setPen(QPen(grid, 1, Qt::DashLine));
        p.drawLine(QPointF(xx, r.top()), QPointF(xx, r.bottom()));
      }
      if (!connected)
        pricePath.moveTo(xx, y(b.close));
      else
        pricePath.lineTo(xx, y(b.close));
      connected = true;
    } else {
      p.drawLine(QPointF(xx, y(b.high)), QPointF(xx, y(b.low)));
      const double bodyWidth = std::clamp(step * (theme.preset?.64:.40), 1., theme.preset?10.:4.);
      QRectF body(xx - bodyWidth / 2, y(std::max(b.open, b.close)), bodyWidth,
                  std::max(1.5, std::abs(y(b.open) - y(b.close))));
      if(theme.hollowUp&&b.close>=b.open){p.setBrush(bg);p.drawRect(body);p.setBrush(Qt::NoBrush);}else p.fillRect(body, color);
    }
    if (overlay && std::isfinite(overlayData[i])) {
      if (!emaConnected)
        emaPath.moveTo(xx, y(overlayData[i]));
      else
        emaPath.lineTo(xx, y(overlayData[i]));
      emaConnected = true;
    } else
      emaConnected = false;
    if (showNine && !minute) {
      auto &s = seq[i];
      if (s.setup > 0 && s.runLength <= 9)
        mark(QString::number(s.setup), xx,
             s.direction < 0 ? y(b.low) + 15 : y(b.high) - 6,
             s.direction < 0 ? down : up);
      if (s.countdown > 0 && (i == 0 || seq[i - 1].countdown != s.countdown ||
                              s.cdTriggered || s.deferred)) {
        QString label =
            "C" + QString::number(s.countdown) + (s.deferred ? "+" : "");
        mark(label, xx, s.cdDirection < 0 ? y(b.low) + 24 : y(b.high) - 20,
             QColor("#aa80e5"));
      }
    }
  }
  if (minute) {
    int latest = end - 1;
    while (latest >= 0 && !market::valid(bars[latest])) --latest;
    p.setPen(QPen(!(previousClose > 0) || latest < 0    ? muted
                  : bars[latest].close >= previousClose ? up
                                                        : down,
                  1.7));
    p.drawPath(pricePath);
    if (previousClose > 0) {
      p.setPen(QPen(muted, 1, Qt::DashLine));
      p.drawLine(QPointF(r.left(), y(previousClose)),
                 QPointF(r.right(), y(previousClose)));
    }
  }
  if (overlay && !minute) {
    const QStringList colors{"#cf982b", "#4588e5", "#a777cf", "#39a696",
                             "#dc6d68", "#8a8f42", "#5b9aa0", "#a48068"};
    for (size_t k = 0; k < maData.size(); ++k) {
      QPainterPath path;
      bool joined = false;
      for (int i = start; i < end; ++i) {
        if (!std::isfinite(maData[k][i])) {
          joined = false;
          continue;
        }
        if (joined)
          path.lineTo(x(i), y(maData[k][i]));
        else
          path.moveTo(x(i), y(maData[k][i]));
        joined = true;
      }
      p.setPen(QPen(appearance::plotColor(theme,QColor(colors[int(k) % colors.size()])),theme.preset?theme.lineWidth:1.2));
      p.drawPath(path);
    }
  }
  if (vwapEnabled) {
    QPainterPath path;bool joined=false;
    for(int i=start;i<end;++i) {
      if(i>=int(vwapData.values.size())||!std::isfinite(vwapData.values[i])){joined=false;continue;}
      if(vwapData.breakBefore[i])joined=false;
      if(joined)path.lineTo(x(i),y(vwapData.values[i]));else path.moveTo(x(i),y(vwapData.values[i]));
      joined=true;
    }
    p.setPen(QPen(appearance::plotColor(theme,QColor("#ca8c13")),theme.preset?theme.lineWidth:1.4));p.drawPath(path);
  }
  chartExtension::paint(p,r,extensionLayers,start,end,x,y,bg,theme);
  if(annotationsEnabled&&annotationError.isEmpty()&&annotationData.status=="available"&&annotationData.selected==selected&&selected>=start&&selected<end){
    auto level=[&](double value,QString label,QColor color){if(!std::isfinite(value)||value<lo||value>hi)return;p.setPen(QPen(color,.8,Qt::DashLine));p.drawLine(QPointF(r.left(),y(value)),QPointF(r.right(),y(value)));mark(label+" "+QString::number(value,'f',priceDecimals),r.right()-52,y(value)-3,color);};
    level(annotationData.r1,"R1",QColor("#b16c4e"));level(annotationData.s1,"S1",QColor("#53879c"));
    if(annotationData.support.present)level(annotationData.support.price,"关键支撑",QColor("#5479b5"));if(annotationData.resistance.present)level(annotationData.resistance.price,"关键压力",QColor("#a46a99"));
    for(auto e:annotationData.events)if(e.index>=start&&e.index<end){QString type=QString::fromStdString(e.type);mark(type.startsWith("breakout")?(e.direction=="positive"?"突":"破"):type.startsWith("gap")?"缺":"量",x(e.index),y(e.price)+(e.direction=="positive"?14:-5),e.direction=="positive"?up:down);}
  }
  p.restore();
  if(vwapEnabled) {
    p.setPen(appearance::plotColor(theme,QColor("#ca8c13")));p.setFont(QFont("Microsoft YaHei UI",8));
    const int at=selected>=start&&selected<end?selected:end-1;
    const QString mode=vwapMode=="actual-amount"?"真实均价":vwapMode=="hlc3-approx"?"HLC3近似":"收盘价加权近似";
    const QString value=at<int(vwapData.values.size())&&std::isfinite(vwapData.values[at])?QString::number(vwapData.values[at],'f',priceDecimals):"—";
    p.drawText(QRectF(r.left()+8,r.top()+4,r.width()-16,18),Qt::AlignRight,"VWAP · "+mode+" "+value);
  }
  const auto volume = volumeRect();
  double vy = volume.top(), vh = volume.height(), volMax = 1;
  for (int i = start; i < end; ++i)
    if (market::valid(bars[i])) volMax = std::max(volMax, bars[i].volume);
  p.setPen(muted);
  p.setFont(QFont("Microsoft YaHei UI", 8));
  p.drawText(QPointF(2, vy - 3), volumeLabel);
  for (int i = start; i < end; ++i)
    if (market::valid(bars[i]) && std::isfinite(bars[i].volume))
      p.fillRect(
          QRectF(x(i) - step * .25, vy + vh - bars[i].volume / volMax * vh,
                 std::max(1., step * .5), bars[i].volume / volMax * vh),
          bars[i].close >= bars[i].open ? up : down);
  const auto indicatorArea = indicatorRect();
  const bool legacy = indicator == "KDJ" || indicator == "RSI" || indicator == "CCI" || indicator == "OBV";
  if (legacy) {
    std::vector<const std::vector<double> *> lines{&subData};
    if (indicator == "KDJ") lines = {&kdjData.k, &kdjData.d, &kdjData.j};
    const QStringList colors{"#4f87d6", "#cf982b", "#a777cf"};
    double low = 0, high = indicator == "KDJ" || indicator == "RSI" ? 100 : 0;
    bool any = false;
    for (const auto *line : lines)
      for (int i = start; i < end; ++i)
        if (i < int(line->size()) && std::isfinite((*line)[i])) {
          any = true;
          low = std::min(low, (*line)[i]); high = std::max(high, (*line)[i]);
        }
    // Scale before padding so finite cumulative volumes near DBL_MAX cannot
    // overflow the visible range or turn every plotted coordinate into NaN.
    const double magnitude = std::max({1., std::abs(low), std::abs(high)});
    double lower = low / magnitude, upper = high / magnitude;
    const double padding = upper > lower ? (upper - lower) * .08 : 1.;
    lower -= padding; upper += padding;
    const auto subY = [&](double value) {
      return indicatorArea.bottom() - (value / magnitude - lower) / (upper - lower) * indicatorArea.height();
    };
    p.setPen(muted);
    p.setFont(QFont("Microsoft YaHei UI", 8));
    p.drawText(QPointF(axisWidth() + 104, indicatorArea.top() - 8), indicatorTitle());
    const int at = selected >= start && selected < end ? selected : end - 1;
    double legendX = axisWidth() + 104 + p.fontMetrics().horizontalAdvance(indicatorTitle()) + 14;
    if (indicator == "KDJ") {
      for (size_t j = 0; j < lines.size(); ++j) {
        const auto &line = *lines[j];
        const QString label = QStringList{"K", "D", "J"}[int(j)] + " " +
            (at < int(line.size()) && std::isfinite(line[at]) ? QString::number(line[at], 'f', 2) : "—");
        p.setPen(appearance::plotColor(theme,QColor(colors[int(j)])));
        p.drawText(QPointF(legendX, indicatorArea.top() - 8), label);
        legendX += p.fontMetrics().horizontalAdvance(label) + 12;
      }
      p.setPen(muted);
      if (at < int(kdjData.ready.size()) && at < int(kdjData.k.size())
          && std::isfinite(kdjData.k[at]) && !kdjData.ready[at])
        p.drawText(QPointF(legendX, indicatorArea.top() - 8), "初始化");
    } else {
      const auto details = indicatorValues(at);
      p.drawText(QRectF(legendX, indicatorArea.top() - 24, std::max(0., width() - legendX - 8), 20),
          Qt::AlignVCenter, p.fontMetrics().elidedText(details, Qt::ElideRight, std::max(0, int(width() - legendX - 8))));
    }
    if (!any) {
      p.setPen(muted);
      p.drawText(indicatorArea, Qt::AlignCenter, "样本不足 / 数据缺口");
    }
    p.save();
    p.setClipRect(indicatorArea);
    p.setPen(grid);
    p.drawLine(QPointF(indicatorArea.left(), subY(0)), QPointF(indicatorArea.right(), subY(0)));
    for (size_t j = 0; j < lines.size(); ++j) {
      QPainterPath path;
      bool joined = false;
      const auto &line = *lines[j];
      for (int i = start; i < end; ++i) {
        if (i >= int(line.size()) || !std::isfinite(line[i])) { joined = false; continue; }
        const bool before = i > start && std::isfinite(line[i - 1]);
        const bool after = i + 1 < end && i + 1 < int(line.size()) && std::isfinite(line[i + 1]);
        if (!before && !after) {
          p.setPen(QPen(appearance::plotColor(theme,QColor(colors[int(j)])), 3.6, Qt::SolidLine, Qt::RoundCap));
          p.drawPoint(QPointF(x(i), subY(line[i])));
        }
        if (joined) path.lineTo(x(i), subY(line[i]));
        else path.moveTo(x(i), subY(line[i]));
        joined = true;
      }
      p.setPen(QPen(appearance::plotColor(theme,QColor(colors[int(j)])),theme.preset?theme.lineWidth:1.4));
      p.drawPath(path);
    }
    p.restore();
    p.setFont(QFont("Consolas", 8));
    p.setPen(muted);
    QList<QRectF> tickLabels;
    // Zero is meaningful for signed indicators. Keep it instead of an almost
    // coincident extreme, and reduce numeric precision rather than clipping a sign.
    for (const double value : {0., high, low}) {
      const QRectF box(0, std::clamp(subY(value) - 8, indicatorArea.top(), indicatorArea.bottom() - 16),
                       indicatorArea.left() - 4, 16);
      if (std::any_of(tickLabels.begin(), tickLabels.end(), [&box](const QRectF &other) {
            return other.intersects(box);
          })) continue;
      QString text;
      for (int precision = 4; precision >= 1; --precision) {
        text = QString::number(value, 'g', precision);
        if (p.fontMetrics().horizontalAdvance(text) <= box.width()) break;
      }
      p.drawText(box, Qt::AlignRight | Qt::AlignVCenter, text);
      tickLabels.append(box);
    }
  } else {
  double sy = indicatorArea.top(), sh = indicatorArea.height(), maxSub = 0;
  bool anySub = false;
  for (int i = start; i < end; ++i) {
    if (std::isfinite(subData[i])) {
      anySub = true;
      maxSub = std::max(maxSub, std::abs(subData[i]));
    }
    if (indicator == "MACD")
      for (auto v : {dif[i], dea[i]})
        if (std::isfinite(v)) {
          anySub = true;
          maxSub = std::max(maxSub, std::abs(v));
        }
  }
  maxSub = std::max(1e-9, maxSub) * 1.16;
  double mid = indicator == "MACD" ? sy + sh / 2 : sy + sh;
  auto subY = [&](double v) {
    return mid - v / maxSub * sh * (indicator == "MACD" ? .5 : 1);
  };
  p.setPen(muted);
  p.drawText(QPointF(axisWidth() + 104, sy - 8),
             indicator +
                 (indicator == "MACD"
                      ? QString(" %1,%2,%3 · 柱×2")
                            .arg(macdFast)
                            .arg(macdSlow)
                            .arg(macdSignal)
                      : QString(" %1").arg(indicator == "ATR" ? atrPeriod
                                                              : volumePeriod)));
  if (!anySub) p.drawText(indicatorArea, Qt::AlignCenter, "连续样本不足");
  p.setPen(grid);
  p.drawLine(QPointF(r.left(), mid), QPointF(r.right(), mid));
  QPainterPath sub, dp, ap;
  bool sc = false, dc = false, ac = false;
  for (int i = start; i < end; ++i) {
    if (indicator == "MACD") {
      if (std::isfinite(subData[i])) {
        p.setPen(QPen(subData[i] >= 0 ? up : down, std::max(1., step * .45)));
        p.drawLine(QPointF(x(i), mid), QPointF(x(i), subY(subData[i])));
      }
      if (std::isfinite(dif[i])) {
        if (dc)
          dp.lineTo(x(i), subY(dif[i]));
        else
          dp.moveTo(x(i), subY(dif[i]));
        dc = true;
      } else
        dc = false;
      if (std::isfinite(dea[i])) {
        if (ac)
          ap.lineTo(x(i), subY(dea[i]));
        else
          ap.moveTo(x(i), subY(dea[i]));
        ac = true;
      } else
        ac = false;
    } else {
      if (!std::isfinite(subData[i])) {
        sc = false;
        continue;
      }
      if (!sc)
        sub.moveTo(x(i), subY(subData[i]));
      else
        sub.lineTo(x(i), subY(subData[i]));
      sc = true;
    }
  }
  p.setPen(QPen(theme.fast,theme.preset?theme.lineWidth:1.4));
  p.drawPath(sub);
  p.drawPath(dp);
  p.setPen(QPen(theme.slow,theme.preset?theme.lineWidth:1.4));
  p.drawPath(ap);
  }
  p.setFont(QFont("Consolas", 8));
  p.setPen(muted);
  for (int j = 0; j < 5; ++j) {
    int i = start + (n - 1) * j / 4;
    const bool legacyAxis=minute&&annotationMeta.value("legacyHistorical").toBool();
    const QString tick = minute ? QStringList{legacyAxis?"09:15":"09:30", "10:30", "11:30/13:00",
                                              "14:00", "15:00"}[j]
                                : labels.value(i);
    const double tw = p.fontMetrics().horizontalAdvance(tick) + 4;
    const double fraction=legacyAxis?(j==0?0.0:(10.0+60*j)/250.0):j/4.0;
    const double tickX = minute ? r.left() + r.width() * fraction : x(i);
    if(width()<600 && j%2==1)continue;
    if(!minute && n<5 && j!=0 && i==start+(n-1)*(j-1)/4)continue;
    p.drawText(QRectF(std::clamp(tickX - tw / 2, r.left(), std::max(r.left(),r.right() - tw)),
                      height() - 24, tw, 18),
               Qt::AlignCenter, tick);
  }
  if (selected >= start && selected < end) {
    double xx = x(selected);
    p.setPen(QPen(QColor("#8598b3"), 1, Qt::DashLine));
    p.drawLine(QPointF(xx, r.top()), QPointF(xx, height() - 28));
    if (market::valid(bars[selected]))
      p.drawLine(QPointF(r.left(), y(bars[selected].close)),
                 QPointF(r.right(), y(bars[selected].close)));
  }
}
void Chart::selectAt(double xx) {
  const int previousSelection = selected;
  int end = std::clamp(endIndex, 1, int(bars.size())),
      start = std::max(0, end - visibleCount);
  selected = std::clamp(start + int((xx - priceRect().left()) /
                                    priceRect().width() * (end - start)),
                        start, end - 1);
  if (minute) {
    double best = INFINITY;
    for (int i = start; i < end; ++i) {
      const double x = barX(i), distance = std::abs(x - xx);
      if (distance < best) {
        best = distance;
        selected = i;
      } else if (distance == best) {
        if (x != barX(selected) || !std::isfinite(lastInspectX) || xx < lastInspectX)
          selected = i;
        else if (xx == lastInspectX)
          selected = previousSelection >= start && previousSelection < end &&
                             barX(previousSelection) == x
                         ? previousSelection
                         : i;
      }
    }
    lastInspectX = xx;
  }
  update();
  emit barSelected(selected);
}
QPair<double,double> Chart::priceBounds(int start,int end) const {
  double lo=INFINITY,hi=-INFINITY;
  for(int i=start;i<end;++i)if(market::valid(bars[i])){
    lo=std::min(lo,bars[i].low);hi=std::max(hi,bars[i].high);
    if(vwapEnabled&&i<int(vwapData.values.size())&&std::isfinite(vwapData.values[i])){lo=std::min(lo,vwapData.values[i]);hi=std::max(hi,vwapData.values[i]);}
    if(!minute&&overlay)for(const auto&data:maData)if(i<int(data.size())&&std::isfinite(data[i])){lo=std::min(lo,data[i]);hi=std::max(hi,data[i]);}
  }
  if(!std::isfinite(lo))return {lo,hi};
  chartExtension::range(extensionLayers,start,end,lo,hi);
  if(minute&&previousClose>0){lo=std::min(lo,previousClose);hi=std::max(hi,previousClose);}
  double pad=std::max({(hi-lo)*.10,std::abs(hi)*.003,1e-6});return {lo-pad,hi+pad};
}
QPointF Chart::extensionPoint(int index,double price) const {
  if(bars.empty())return {};
  int end=std::clamp(endIndex,1,int(bars.size())),start=std::max(0,end-visibleCount);
  const auto range=priceBounds(start,end);auto r=priceRect();
  return {barX(index),r.bottom()-(price-range.first)/(range.second-range.first)*r.height()};
}
chartExtension::Hit Chart::extensionItemAt(QPointF point) const {
  if(bars.empty()||minute)return {};
  int end=std::clamp(endIndex,1,int(bars.size())),start=std::max(0,end-visibleCount);
  const auto range=priceBounds(start,end);if(!std::isfinite(range.first))return {};
  auto r=priceRect();
  return chartExtension::hitTest(point,r,extensionLayers,start,end,[&](int i){return barX(i);},
    [&](double price){return r.bottom()-(price-range.first)/(range.second-range.first)*r.height();});
}
void Chart::wheelEvent(QWheelEvent *e) {
  if (bars.empty()) return;
  if (minute) {
    e->accept();
    return;
  }
  visibleCount = std::clamp(visibleCount + (e->angleDelta().y() > 0 ? -8 : 8),
                            std::min(16, int(bars.size())), int(bars.size()));
  update();
  e->accept();
}
void Chart::mousePressEvent(QMouseEvent *e) {
  if (bars.empty()) return;
  lastInspectX = NAN;
  press = e->pos();
  startEnd = endIndex;
  dragging = true;
  extensionDragged = false;
  selectAt(e->position().x());
}
void Chart::mouseMoveEvent(QMouseEvent *e) {
  if(dragging&&(e->position()-QPointF(press)).manhattanLength()>4)extensionDragged=true;
  if (dragging && minute) {
    selectAt(e->position().x());
    return;
  }
  if (dragging && std::abs(e->pos().x() - press.x()) > 4) {
    int delta =
        int((e->pos().x() - press.x()) * visibleCount / priceRect().width());
    endIndex =
        std::clamp(startEnd - delta, std::min(visibleCount, int(bars.size())),
                   int(bars.size()));
    update();
  }
}
void Chart::mouseReleaseEvent(QMouseEvent *e) {
  bool clicked=dragging&&!extensionDragged&&e->button()==Qt::LeftButton&&(e->position()-QPointF(press)).manhattanLength()<=4;
  dragging=false;lastInspectX=NAN;
  if(clicked){auto hit=extensionItemAt(e->position());emit extensionItemSelected(hit.owner,hit.id);}
}
void Chart::keyPressEvent(QKeyEvent *e) {
  if (e->key() == Qt::Key_Home)
    latest();
  else if (e->key() == Qt::Key_Left || e->key() == Qt::Key_Right) {
    if (!bars.empty()) {
      selected = std::clamp(selected + (e->key() == Qt::Key_Left ? -1 : 1), 0,
                            int(bars.size()) - 1);
      update();
      emit barSelected(selected);
    }
  } else
    QWidget::keyPressEvent(e);
}

void Chart::refreshAnnotations(int index){refreshAnnotationsFor(index,false);}
void Chart::refreshAnnotationsFor(int index,bool reader){
 if(index==-2)index=selected;
 if(!annotationsEnabled&&!reader){annotationData={};annotationError.clear();annotationCached=false;annotationSourceRows={};annotationSourceMeta={};update();return;}
 try{
  if(annotationRows.size()!=int(bars.size()))throw std::runtime_error("annotation-source-not-aligned");
  for(int i=0;i<int(bars.size());++i){auto row=annotationRows[i].toObject();const auto&b=bars[i];auto same=[](double a,double b){return a==b||(std::isnan(a)&&std::isnan(b));};if(!same(chartAnnotationInput::n(row,"time"),b.time)||!same(chartAnnotationInput::n(row,"open"),b.open)||!same(chartAnnotationInput::n(row,"high"),b.high)||!same(chartAnnotationInput::n(row,"low"),b.low)||!same(chartAnnotationInput::n(row,"close"),b.close)||!same(chartAnnotationInput::n(row,"volume"),b.volume)||row.value("valid").toBool()!=b.valid||row.value("closed").toBool()!=b.closed)throw std::runtime_error("annotation-source-not-aligned");}
  if(annotationCached&&annotationIndex==index&&annotationData.selected==index&&annotationError.isEmpty()&&annotationSourceRows==annotationRows&&annotationSourceMeta==annotationMeta){update();return;}
  annotationCached=false;annotationData={};annotationError.clear();
  annotationData=chartAnnotationInput::calculate(annotationRows,annotationMeta,index);
  annotationSourceRows=annotationRows;annotationSourceMeta=annotationMeta;annotationIndex=index;annotationCached=true;
 }catch(const std::exception&e){annotationCached=false;annotationSourceRows={};annotationSourceMeta={};annotationData={};annotationError=QString::fromUtf8(e.what());}
 update();
}
QString Chart::annotationText(int index){refreshAnnotationsFor(index,true);return annotationError.isEmpty()?chartAnnotationInput::explain(annotationData,annotationRows,annotationMeta):"关键位与历史事件不可用："+annotationError+"；未替换来源或补零。";}
void Chart::hideEvent(QHideEvent*e){if(minute)dragging=false;lastInspectX=NAN;annotationCached=false;annotationSourceRows={};annotationSourceMeta={};annotationData={};annotationError="page-inactive";QWidget::hideEvent(e);}
void Chart::showEvent(QShowEvent*e){lastInspectX=NAN;QWidget::showEvent(e);refreshAnnotations();}

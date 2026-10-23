#pragma once
#include "vwap.hpp"
#include <cmath>
#include <QDateTime>
#include <QJsonArray>
#include <QJsonObject>
namespace vwapChartInput {
inline double number(const QJsonObject& row,const char* key){return row[key].isDouble()?row[key].toDouble():NAN;}
inline vwap::Series calculate(const QJsonArray& rows,const QJsonObject& meta,
                             const QString& period,const QString& mode,const QString& anchor) {
  const bool minute=period.startsWith("minute");
  vwap::Params p;p.mode=mode.toStdString();p.period=minute?"intraday":period.toStdString();
  p.anchor=(anchor=="auto"?(minute?QString("session"):QString("loaded-window")):anchor).toStdString();
  p.volumeUnit=meta["volumeUnit"].toString("unknown").toStdString();
  p.volumeToShares=number(meta,"volumeToShares");p.amountToCny=meta["amountUnit"]=="CNY"?number(meta,"amountToCny"):NAN;
  p.priceBasis=meta["adjustment"]=="none"?"unadjusted":meta["adjustment"].toString().isEmpty()?"unknown":"adjusted";
  // All native chart rows are interval quantities. Never silently use a
  // cumulative field or a daily quote total as one interval's amount.
  if(mode=="actual-amount"&&meta["quantitySemantics"]!="incremental")p.amountToCny=NAN;
  const auto receipt=QDateTime::fromString(meta["checkedAt"].toString(),Qt::ISODate);
  std::vector<vwap::Point> points;
  for(auto value:rows){auto row=value.toObject();vwap::Point point;
    const double time=number(row,"time");
    if(std::isfinite(time)&&time>=0&&time<=253402214400000.0)point.time=qint64(time);
    const auto date=QDateTime::fromMSecsSinceEpoch(point.time,Qt::UTC).addSecs(8*3600);
    point.session=point.time>=0?date.date().toString(Qt::ISODate).toStdString():"";
    point.high=number(row,"high");point.low=number(row,"low");point.close=number(row,"close");
    point.volume=number(row,"volume");point.amount=number(row,"amount");point.valid=row["valid"].toBool();point.closed=row["closed"].toBool();
    point.axisGap=minute&&!point.valid&&receipt.isValid()&&point.time>receipt.toMSecsSinceEpoch();
    points.push_back(point);
  }
  p.anchorId=points.empty()?"empty":std::to_string(points.front().time);
  // A 09:30 axis slot does not prove observations cover the full session.
  p.coversFromOpen=false;
  return vwap::calculate(points,p);
}
}

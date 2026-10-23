#pragma once
#include <QCryptographicHash>
#include <QJsonArray>
#include <QJsonObject>
#include <QRegularExpression>
#include <QStringList>
#include <QMap>
#include <limits>
#include <QDateTime>
#include <cmath>

// Mirrors creatorDocumentState.js. This is admission/triage, never accuracy or fact checking.
namespace collectionQuality {
inline QString bodyHash(const QString& body) {
  return QString::fromLatin1(QCryptographicHash::hash(body.toUtf8(), QCryptographicHash::Sha256).toHex());
}
inline bool validReview(const QJsonObject& review) {
  return QRegularExpression("^[a-f0-9]{64}$").match(review["bodyHash"].toString()).hasMatch()
      && !review["note"].toString().trimmed().isEmpty() && review["note"].toString().size()<=2000
      && review["scope"]=="transcript_only" && QDateTime::fromString(review["reviewedAt"].toString(),Qt::ISODateWithMs).isValid();
}
inline QJsonObject safeSource(const QString& mediaType, const QString& text, const QJsonObject& metadata) {
  const auto oldAsr=metadata["asr"].toObject();
  QString baseline=mediaType=="note"?bodyHash(text):oldAsr["transcript"].isString()?bodyHash(oldAsr["transcript"].toString()):QString();
  QJsonObject out{{"mediaType",mediaType},{"bodyHash",baseline}};
  for(const auto& key:QStringList{"asr","note"}) {
    if(!metadata[key].isObject()) continue;
    auto input=metadata[key].toObject();QJsonObject part;
    for(const auto& field:QStringList{"status","model"})
      if(input[field].isString()) part[field]=input[field].toString().left(200);
    for(const auto& field:QStringList{"durationSeconds","imageCount"})
      if(input[field].isDouble()||input[field].isString()) part[field]=input[field];
    auto quality=input["quality"].toObject();QJsonArray reasons;
    for(auto r:quality["reasons"].toArray())
      if(QRegularExpression("^[a-z0-9_]{1,80}$").match(r.toString()).hasMatch()&&!reasons.contains(r)) reasons.append(r);
    if(quality.contains("needsReview")) part["quality"]=QJsonObject{{"needsReview",quality["needsReview"]},{"reasons",reasons}};
    else if(!reasons.isEmpty()) part["quality"]=QJsonObject{{"reasons",reasons}};
    const QString list=key=="asr"?"segments":"pages";
    if(input[list].isArray()) {
      QJsonArray items;auto raw=input[list].toArray();
      if(raw.size()>(key=="asr"?50000:50)) {
        reasons.append("metadata_limit_exceeded");part["quality"]=QJsonObject{{"needsReview",true},{"reasons",reasons}};
      } else for(auto v:raw) {
        QJsonObject item, r=v.toObject();
        for(const auto& field:QStringList{"start","end","index"})
          if(r[field].isDouble()||r[field].isString()) item[field]=r[field];
        for(const auto& field:QStringList{"status","text"})if(r[field].isString())item[field]=r[field];
        items.append(item);
      }
      part[list]=items;
    }
    out[key]=part;
  }
  return out;
}
inline double metric(QJsonValue value) {
  bool ok=false;double n=value.isDouble()?value.toDouble():value.toString().toDouble(&ok);
  return (value.isDouble()||ok)&&std::isfinite(n)?n:std::numeric_limits<double>::quiet_NaN();
}
inline QJsonObject evaluate(const QJsonObject& row) {
  const auto raw=row["text"].toString(), body=raw.trimmed();
  const auto saved=row["qualitySource"].toObject();
  const auto native=row["asrResult"].toObject();
  bool hasNative=!native.isEmpty(), note=!hasNative&&saved["mediaType"]=="note";
  const auto source=hasNative?native:saved[note?"note":"asr"].toObject();
  QString expected=hasNative?bodyHash(native["transcript"].toString(native["text"].toString())):saved["bodyHash"].toString();
  bool edited=!expected.isEmpty()&&expected!=bodyHash(raw);
  auto quality=source["quality"].toObject();QJsonArray reasons;
  auto reason=[&](const QString& r){if(!reasons.contains(r))reasons.append(r);};
  for(auto r:quality["reasons"].toArray())if(r.isString()&&!r.toString().isEmpty())reason(r.toString());
  static const QRegularExpression echo("请(?:使用中国大陆简体中文逐字转写|只分析以下财经文稿)|不要改写、总结或补充原文|以下是中国大陆普通话财经视频|重点术语\\s*[：:]|(?:提取|总结)(?:产业链)?关系.{0,30}只返回JSON",QRegularExpression::CaseInsensitiveOption);
  if(echo.match(body).hasMatch())reason("prompt_echo");
  double duration=metric(source["durationSeconds"]);
  // Android offset is part of media timeline; decoded duration alone is not its end timestamp.
  if(!std::isfinite(duration)&&hasNative&&source["decodedSeconds"].isDouble())duration=source["decodedSeconds"].toDouble()+source["audioOffsetSeconds"].toDouble();
  if(!note)for(auto v:source["segments"].toArray()) {
    auto s=v.toObject();double a=metric(s["start"]),b=metric(s["end"]);
    if(a<0||b<0||(std::isfinite(a)&&std::isfinite(b)&&b<a)||(duration>0&&(a>duration+1||b>duration+1)))reason("timestamp_out_of_range");
  }
  bool nativeComplete=hasNative&&duration>0&&source["segments"].isArray()&&!source["segments"].toArray().isEmpty();
  QString joined;double last=0;
  if(hasNative)for(auto v:source["segments"].toArray()){
    const auto s=v.toObject();double a=metric(s["start"]),b=metric(s["end"]);
    nativeComplete=nativeComplete&&std::isfinite(a)&&std::isfinite(b)&&a>=last&&b>=a&&b<=duration+1&&!s["text"].toString().isEmpty();
    if(!joined.isEmpty()&&!source.contains("transcript"))joined+='\n';joined+=s["text"].toString();last=b;
  }
  nativeComplete=nativeComplete&&joined==source["transcript"].toString(source["text"].toString());
  if(hasNative&&!nativeComplete)reason("incomplete_asr_evidence");
  QString status=source["status"].toString(nativeComplete?"complete":"");
  bool complete=false;
  if(note) {
    auto pages=source["pages"].toArray();double count=metric(source["imageCount"]);
    complete=source["imageCount"].isDouble()&&count>=1&&count<=50&&count==pages.size();bool some=false;
    for(int i=0;i<pages.size();++i){auto p=pages[i].toObject();QString t=p["text"].toString().trimmed();some|=!t.isEmpty();
      complete=complete&&p["index"].toInt()==i+1&&((p["status"]=="recognized"&&!t.isEmpty()&&body.contains(t))||(p["status"]=="no_text"&&t.isEmpty()));}
    complete=complete&&some&&QStringList{"complete","needs_review"}.contains(status);
  }else complete=QStringList{"complete","needs_review"}.contains(status)&&(!hasNative||nativeComplete);
  QString extraction=body.isEmpty()?"empty":status=="error"?"error":complete?"complete":status=="no_text"||status=="no_speech"?"empty":source.isEmpty()?"missing":"partial";
  if(edited)reason("body_edited");
  if(!hasNative&&!note&&!saved.isEmpty()&&expected.isEmpty())reason("missing_body_baseline");
  QString gate="ready";
  if(reasons.contains("prompt_echo"))gate="suspected_prompt_echo";
  else if(note&&(!complete||!reasons.isEmpty()||quality["needsReview"].toBool()))gate="note_ocr_required";
  else if(!reasons.isEmpty()||quality["needsReview"].toBool()||(!note&&status=="needs_review"))gate="asr_review_required";
  else if(body.size()<30)gate="missing_text";
  else if(!complete)gate="asr_review_required";
  QString machine=!reasons.isEmpty()||quality["needsReview"].toBool()||(!note&&status=="needs_review")?"review_required":extraction=="complete"?"pass":"not_evaluated";
  auto reviews=row["qualityReviews"].toArray();QString human=reviews.isEmpty()?"unreviewed":"outdated";
  if(!reviews.isEmpty()) {const auto lastReview=reviews.last().toObject();if(!validReview(lastReview))human="unreviewed";else if(lastReview["bodyHash"]==bodyHash(raw))human="reviewed";}
  return {{"schema","native-document-quality-v1"},{"extraction",extraction},{"machineQuality",machine},{"humanReview",human},{"claimScope","author_claim"},{"bodyHash",bodyHash(raw)},{"textLength",body.size()},{"qualityReasons",reasons},{"gate",gate},{"eligibleForAnalysis",gate=="ready"},{"model",source["model"].toString()}};
}
inline QString describe(const QJsonObject& row) {
  auto q=evaluate(row);QStringList reasons;
  const QMap<QString,QString> labels{{"prompt_echo","疑似提示词回声"},{"timestamp_out_of_range","识别时间超出媒体范围"},{"body_edited","正文已编辑，不能沿用识别稿质检"},{"incomplete_asr_evidence","缺少完整识别分段 / 时长"},{"missing_body_baseline","缺少原识别正文基线"}};
  for(auto r:q["qualityReasons"].toArray())reasons<<labels.value(r.toString(),r.toString());
  auto machine=q["machineQuality"].toString(), human=q["humanReview"].toString();
  return QString("机器质检：%1\n人工复核：%2\n正文：%3字 · %4\n%5\n模型：%6\n机器未标异常不等于识别准确或事实已证实；本页仅记录文稿复核。")
    .arg(machine=="pass"?"未标异常":machine=="review_required"?"待复核":"未评估 / 缺提取证据",
         human=="reviewed"?"当前正文有复核记录":human=="outdated"?"正文变化，旧复核已过期":"未复核")
    .arg(q["textLength"].toInt()).arg(q["eligibleForAnalysis"].toBool()?"满足机器分析准入，不代表已有分析":"不满足机器分析准入")
    .arg(reasons.join("；"),q["model"].toString().isEmpty()?"未提供":q["model"].toString());
}
}

#pragma once
#include "evidence_review_model.hpp"
class EvidenceReviewStore {
 QString file;
 public:
 explicit EvidenceReviewStore(const QString&);
 QJsonObject get(const QString&,const QString&) const;
 QJsonArray list(const QString&,int offset=0) const;
 QJsonObject put(QJsonObject,const QString& expected={});
 QJsonObject preview(const QByteArray&) const;
 QJsonObject stage(const QJsonObject&,const QString& expected);
 QJsonObject merge(const QJsonObject&,const QString& stagedRevision);
 QJsonObject approve(const QString& reportId,const QJsonArray& selected,bool acknowledge,const QJsonArray& catalogue);
 QByteArray backup() const;
};

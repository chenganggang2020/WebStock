#pragma once
#include "comment_workshop_model.hpp"
#include <optional>
class CommentWorkshopStore {
  QString file;
 public:
  explicit CommentWorkshopStore(const QString&);
  QJsonObject get(const QString& kind,const QString& id) const;
  QJsonArray list(const QString& kind,int offset=0) const;
  QJsonObject labels(const QString& bundleId) const;
  QJsonObject put(QJsonObject row,const QString& expectedRevision={});
  QJsonObject preview(const QByteArray&) const;
  QJsonObject merge(const QJsonObject&, std::optional<QString> expectedPreviewRevision = {});
  QJsonObject archiveRule(const QString& id,const QString& expectedRevision);
  QJsonObject restoreRule(const QString& archiveId);
  QByteArray backup() const;
};

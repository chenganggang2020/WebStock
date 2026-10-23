#pragma once
#include <QString>
#include <QJsonArray>
#include <QJsonObject>
class SourceHandoffStore {
  QString file;
 public:
  explicit SourceHandoffStore(const QString& absoluteFile);
  QJsonObject saveResult(const QJsonObject& packet, const QString& title, const QString& answer);
  QJsonObject saveDraft(const QJsonObject&, const QString& expectedRevision = {});
  QJsonObject draft() const;
  QJsonArray page(int offset = 0, const QString& kind = {}) const;
  QJsonObject detail(const QString&) const;
  QJsonObject previewImport(const QByteArray&, const QString& sourceKey) const;
  QJsonObject merge(const QJsonObject& preview);
  QByteArray backup() const;
};

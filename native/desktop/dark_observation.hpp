#pragma once
#include <QtCore>
#include <functional>
namespace darkObservation {
using Cancel = std::function<bool()>;
struct Prepared {
  QByteArray bytes;
  QString id, preparedAt;
  QJsonObject summary;
};
QString hash(const QJsonValue &value);
Prepared prepare(const QJsonObject &snapshot, const QString &preparedAt,
                 const Cancel &cancel = {});
QJsonObject compare(const QJsonObject &from, const QJsonObject &to);
QJsonObject previewLegacy(const QString &directory,const QString &sourceDirectory,
                          const QJsonArray &sourceFiles,const Cancel &cancel = {});
QJsonObject applyLegacy(const QString &directory,const QJsonObject &preview,
                       const Cancel &cancel = {});
QJsonObject removeLegacy(const QString &directory,const QString &pointId,
                        const QString &expectedRevision,const Cancel &cancel = {});
QJsonObject legacyCatalog(const QString &directory,const Cancel &cancel = {});
class Store {
  QString directory;

public:
  explicit Store(QString directory) : directory(std::move(directory)) {}
  QJsonObject preview(const Prepared &prepared,
                      const Cancel &cancel = {}) const;
  QJsonObject append(const Prepared &prepared, const QString &expectedRevision,
                     const QString &savedAt, const Cancel &cancel = {}) const;
  QJsonObject read(const QString &key, const QString &tradingDay,
                   const Cancel &cancel = {}) const;
  QString path() const { return directory; }
};
} // namespace darkObservation

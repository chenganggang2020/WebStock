#pragma once
#include "local_candidate_model.hpp"
namespace localCandidate {
class Store final {
 public:
  explicit Store(QString file):file(std::move(file)){}
  QJsonArray list(const Cancel& cancelled={}) const;
  QJsonObject read(const QString& id,const Cancel& cancelled={}) const;
  QJsonObject readDraft(const QString& anchor,const Cancel& cancelled={}) const;
  QString putDraft(const QJsonObject& result,const Cancel& cancelled={}) const;
  QString save(const QString& title,const QJsonObject& result,const QDateTime& now=QDateTime::currentDateTimeUtc(),const Cancel& cancelled={}) const;
  void remove(const QString& id,const Cancel& cancelled={}) const;
  QString putExport(const QByteArray& bytes,const Cancel& cancelled={}) const;
  QByteArray readExport(const QString& anchor,const Cancel& cancelled={}) const;
  QString filePath() const{return file;}
 private:QString file;
};
}

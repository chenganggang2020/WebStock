#pragma once
#include "news_model.hpp"
namespace publicNews {
class Store {
 public:explicit Store(QString file):file(std::move(file)){}
 QJsonObject archive(const Cancel& cancel={})const;QJsonObject saveArchive(QJsonObject,qint64 expected,const Cancel& cancel={})const;QJsonObject importPreview(QJsonObject,const Cancel& cancel={})const;
 QJsonObject cache(QJsonObject query,const Cancel& cancel={})const;void saveSnapshot(QJsonObject,const Cancel& cancel={})const;void failure(QJsonObject query,QString message,const Cancel& cancel={})const;
 QJsonObject article(QJsonObject item,const Cancel& cancel={})const;void saveArticle(QJsonObject item,QJsonObject article,const Cancel& cancel={})const;
 private:QString file;
};
void exportNew(QByteArray bytes,QString path,const Cancel& cancel={});
}

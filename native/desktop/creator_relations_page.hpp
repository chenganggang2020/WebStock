#pragma once
#include "creator_archive.hpp"
#include <QtWidgets>
class CreatorRelationsPage : public QWidget {
  std::function<QJsonArray()> source;
  std::function<void(const QJsonObject&)> open;
  creatorArchive::Store archive;
  QStackedWidget* pages;QWidget* workspace;QWidget* reading;
  QPlainTextEdit* fullText;QLabel* readerTitle;QPushButton *backButton,*evidenceOpen;
  std::function<void()> readerAction;quint64 epoch=0;
  void invalidatePreview();
  QComboBox *authors,*topics,*mode;
  QLineEdit* focus;
  QLabel* counts;
  QGraphicsView* view;
  QGraphicsScene* scene;
  QTableWidget* history;
  QPushButton *previous,*next,*confirm;
  QJsonArray input,relations,records;
  QJsonObject index,pending,projection;
  QString author,topic;
  int page=0;
  bool binding=false;
  void safe(const std::function<void()>&);
  void reload();
  void render();
  void evidence(const QJsonObject&);
  void review(const QByteArray&);
  void reader(const QString&,const QString&);
 protected:
  void hideEvent(QHideEvent*)override;
 public:
  CreatorRelationsPage(std::function<QJsonArray()> source,QString archivePath,std::function<void(const QJsonObject&)> open,QWidget* parent=nullptr);
  std::function<void()> onBack;
  bool back();
  // Real page methods exposed for bounded local runtime checks and controlled file adapters.
  void previewBytes(const QByteArray& bytes){review(bytes);}
  void selectAuthor(const QString& key){authors->setCurrentIndex(authors->findData(key));}
  void selectTopic(const QString& key){topics->setCurrentIndex(topics->findData(key));}
};


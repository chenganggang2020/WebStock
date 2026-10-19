#pragma once
#include "person_method_store.hpp"
#include <QWidget>
#include <QLineEdit>
#include <QComboBox>
#include <QPlainTextEdit>
#include <QListWidget>
#include <QLabel>
#include <QStackedWidget>
#include <QTimer>
#include <functional>
#include <memory>
#include "page_snapshot_reader.hpp"
class PersonMethodPage : public QWidget {
 std::shared_ptr<PersonMethodStore> store;
 std::function<QJsonArray()> versions;
 std::function<void(QJsonObject)> opener;
 QComboBox *mode,*typeFilter,*reviewFilter,*refPicker,*boundPicker;
 QLineEdit* search;
 QListWidget* list;
 QLabel *status,*identity,*refsLabel;
 QStackedWidget* views;
 QPlainTextEdit* reader;
 QHash<QString,QPlainTextEdit*> fields;
 QJsonObject baseline,draft,pending,pendingBaseline,readerRef;
 QJsonArray references;
 QString subjectId;
 bool filling=false,dirty=false,viewWritable=false;
 QTimer draftTimer;
 PageSnapshotReader* snapshotReader=nullptr;
 QJsonObject catalog;
 QJsonArray externalVersions;
 void reload();
 QString statePath()const;
 QString kind()const;
 void message(QString);
 void refresh();
 void load(QJsonObject);
 void newRecord();
 void sync();
 void save(bool archive=false);
 void showOriginal(QJsonObject);
 void addReference();
 void locate();
 QJsonObject state()const;
 void persist()const;
 void restore();
 void guard(std::function<void()>);
public:
 PersonMethodPage(std::shared_ptr<PersonMethodStore>,std::function<QJsonArray()> existingVersions,std::function<void(QJsonObject)> openSource,QWidget* parent=nullptr);
 ~PersonMethodPage()override;
 void previewImport(const QByteArray&);
 void confirmImport();
 void cancelImport();
 bool back();
 void setDarkTheme(bool);
 QJsonObject saveState()const;
 void restoreState(const QJsonObject&);
 bool isLoading()const{return snapshotReader&&snapshotReader->busy();}
};

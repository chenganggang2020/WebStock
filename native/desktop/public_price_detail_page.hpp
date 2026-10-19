#pragma once
#include "public_price_detail_store.hpp"
#include <QWidget>
#include <functional>
class QComboBox;class QLabel;class QTableWidget;class QPlainTextEdit;class QPushButton;
class PublicPriceDetailPage final:public QWidget {
 publicPriceDetail::Store store;QJsonArray frames,rows;QJsonObject loaded;QString readerText;int tablePage=0,readerPage=0;
 QComboBox *instrument,*day,*view;QLabel *status,*pageState,*readerState;QTableWidget*table;QPlainTextEdit*reader;QWidget*plot;QPushButton *previous,*next,*readerPrevious,*readerNext;
 void reload(QString preferred={});void dates();void clear();void render();void renderTable();void renderReader();void showRow(int index);void guard(const std::function<void()>&work);
public:
 explicit PublicPriceDetailPage(QString archiveFile,QWidget*parent=nullptr);
 void setInstrument(QString nativeId);void readSelected();void cancel();
 QJsonObject currentEvidence()const{return loaded;}
 QJsonArray displayedRows()const{return rows;}
};

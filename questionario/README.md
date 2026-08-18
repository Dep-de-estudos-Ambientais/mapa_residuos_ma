# Questionário — Áreas de Descarte Inadequado de Resíduos Sólidos

Este módulo faz parte do mesmo repositório do mapa interativo e deve ser publicado em:

```text
/questionario/
```

O botão **Cadastrar área** existente na página principal abre este formulário.

## Funcionalidades

- registro do código e identificação do ponto;
- caracterização do entorno e da presença de pessoas;
- registro de recursos naturais, plantios/hortas e empreendimentos próximos;
- perguntas complementares sobre situação, acesso e tipos de resíduos;
- geolocalização pelo GPS do aparelho;
- marcação manual de ponto no mapa;
- desenho de polígono para representar a área aproximada do descarte;
- preenchimento automático de município e agrupamento quando a geometria estiver dentro da base territorial do projeto;
- até quatro fotografias, otimizadas antes do envio;
- armazenamento local quando o aparelho estiver offline;
- sincronização posterior com Google Sheets e Google Drive;
- exportação dos registros pendentes em JSON.

## Configurar Google Sheets + Drive

1. Abra a planilha definida para este projeto:

```text
https://docs.google.com/spreadsheets/d/1cU20Pp0QiwWlq1qh5ooe0HhoKW88fOEvJzY-YrnTaSM/edit
```

2. Nessa planilha, acesse **Extensões → Apps Script**.
3. Apague o código existente e cole o conteúdo de:

```text
questionario/google-apps-script/Code.gs
```

4. No Apps Script, execute uma vez a função:

```text
setupProject
```

5. Autorize o acesso solicitado. O backend está configurado para gravar especificamente na planilha de ID:

```text
1cU20Pp0QiwWlq1qh5ooe0HhoKW88fOEvJzY-YrnTaSM
```

A função criará automaticamente:
   - a aba `Descarte_Inadequado`;
   - os cabeçalhos do banco de dados;
   - a pasta `Registros Fotográficos - Descarte Inadequado` no Google Drive.
6. Acesse **Implantar → Nova implantação → Aplicativo da Web**.
7. Configure a execução como sua conta e defina o público de acesso adequado ao uso do formulário.
8. A implantação utilizada neste projeto é:

```text
https://script.google.com/macros/s/AKfycbw2mxoJpCNNGcoWld6bxXRO5DPqop5n7822e85r-KmZrLvqYFirR9DYuK5UYp_YEOyD/exec
```

9. O arquivo `questionario/config.js` já está configurado com essa URL.
10. Faça commit/push das alterações no GitHub. O GitHub Pages publicará a nova configuração.

## Dados geográficos armazenados

Para cada registro, a planilha recebe:

- tipo de geometria (`Point` ou `Polygon`);
- latitude e longitude de referência;
- precisão do GPS, quando disponível;
- geometria completa em GeoJSON.

Isso permite transformar posteriormente os registros em uma camada SIG sem perder os polígonos desenhados no campo.

## Observação sobre modo offline

Os registros podem permanecer em uma fila local no aparelho e ser sincronizados posteriormente. Para que a interface completa, inclusive as bibliotecas cartográficas, esteja disponível sem conexão, abra o formulário ao menos uma vez com internet no dispositivo que será usado em campo.

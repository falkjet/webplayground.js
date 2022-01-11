const { renderToStaticMarkup } = require("react-dom/server");
const React = require("react");

function Table({ columns, documents }) {
  const columnIds = Object.keys(columns);
  return (
    <table>
      <thead>
        <tr>
          {columnIds.map(column => (
            <th key={column}>{columns[column]}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {documents.map(document => (
          <tr key={document._id}>
            {columnIds.map(column => (
              <td key={column}>{document[column]}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const table = ctx => async (dbquery, columns) => {
  const documents = await dbquery.toArray();
  return renderToStaticMarkup(
    <Table columns={columns} documents={documents} />
  );
};

module.exports = { Table, table };

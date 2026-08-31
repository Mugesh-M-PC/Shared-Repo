// Central list-page selectors. Dynamic locator factories accept business values
// while hiding CSS/accessible-name construction from the page object.
/** Create all customer-list locators for one Playwright page. */
function createListPageLocators(page) {
    return {
        listViewTrigger: page.locator('#list-view-picker-button'),
        listViewMenu: page.locator('#list-view-menu'),
        listTitle: page.locator('#list-title-text'),
        searchInput: page.getByRole('searchbox', {
            name: 'Search this list',
        }),
        listViewOption: (listViewName) =>
            page.locator(`[data-list-view="${listViewName}"]`),
        customerAddressLink: (customerName, addressLabel) => {
            // Escape regex characters in customer names before exact matching.
            const escapedName = customerName.replace(
                /[.*+?^${}()|[\]\\]/g,
                '\\$&'
            );

            return page.getByRole('link', {
                name: new RegExp(
                    `^${escapedName}\\s*-\\s*${addressLabel}$`,
                    'i'
                ),
            });
        },
    };
}

module.exports = { createListPageLocators };

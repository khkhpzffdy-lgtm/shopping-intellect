import {
  getList,
  getListItem,
  getUserProduct,
  putList,
  putListItem,
  putUserProduct,
  type MutationQueueRecord
} from '../storage/db';

type CreateListResponse = {
  list?: {
    id?: string;
  };
};

type CreateListItemResponse = {
  item?: {
    id?: string;
    is_checked?: boolean;
  };
  user_product?: {
    id?: string;
  };
};

const isCreateListMutation = (mutation: MutationQueueRecord) =>
  mutation.method === 'POST' && mutation.endpoint === '/lists';

const isCreateListItemMutation = (mutation: MutationQueueRecord) =>
  mutation.method === 'POST' && /^\/lists\/[^/]+\/items$/.test(mutation.endpoint);

export const applyMutationSuccess = async (
  mutation: MutationQueueRecord,
  response: unknown
) => {
  if (isCreateListMutation(mutation)) {
    const list = await getList(mutation.entity_client_uuid);
    if (!list) {
      return;
    }

    await putList({
      ...list,
      id: (response as CreateListResponse | undefined)?.list?.id ?? list.id
    });
    return;
  }

  if (isCreateListItemMutation(mutation)) {
    const item = await getListItem(mutation.entity_client_uuid);
    if (!item) {
      return;
    }

    const userProduct = await getUserProduct(item.user_product_client_uuid);
    const createItemResponse = response as CreateListItemResponse | undefined;

    if (userProduct) {
      await putUserProduct({
        ...userProduct,
        id: createItemResponse?.user_product?.id ?? userProduct.id
      });
    }

    await putListItem({
      ...item,
      id: createItemResponse?.item?.id ?? item.id,
      is_checked: createItemResponse?.item?.is_checked ?? item.is_checked,
      user_product_id: createItemResponse?.user_product?.id ?? item.user_product_id
    });
  }
};
